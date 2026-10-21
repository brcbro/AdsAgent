import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ADS_DIR, REPO_ROOT } from "@ai-ads/core";
import { importCsv } from "./adapters/csv-adapter.js";
import type { AdAccount, AdMetricsDaily, Platform, PlatformAd as PlatformAdRow } from "./types.js";

/** What every platform adapter (Meta, Google) provides to the shared sync. */
export interface AdPlatformAdapter {
  platform: Platform;
  listAccounts(): Promise<AdAccount[]>;
  listAds(accountId: string, seen?: string): Promise<PlatformAdRow[]>;
  fetchDailyMetrics(accountId: string, from: string, to: string): Promise<AdMetricsDaily[]>;
}
import { computeScores } from "./score.js";
import { evaluateOutcomes } from "./outcomes.js";
import { accountSuggestions } from "./suggest.js";
import type { PerformanceStore } from "./store.js";
import type { PlatformAd, ScoreThresholds, ScoreWeights } from "./types.js";

export const PERFORMANCE_DIR = path.join(REPO_ROOT, "data", "performance");
export const INBOX_DIR = path.join(PERFORMANCE_DIR, "inbox");

export interface FileReport { file: string; status: "imported" | "unchanged" | "error"; platform?: string; ads?: number; rows?: number; warnings?: string[]; error?: string }
export interface AccountReport { accountId: string; name: string; status: "synced" | "error"; from?: string; to?: string; ads?: number; rows?: number; error?: string }
export interface SyncReport {
  files: FileReport[];
  accounts: AccountReport[];
  adsScored: number;
  winners: number;
  losers: number;
  fatigued: number;
  linked: number;
  at: string;
}

/** Project IDs are folder names under data/ads; an ad name that contains one is linked to it. */
export function knownProjectIds(adsDir = ADS_DIR): string[] {
  try {
    return fs.readdirSync(adsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort((a, b) => b.length - a.length);
  } catch { return []; }
}

/** `{projectId}_{hook}_{cta}_{ratio}` naming from the exporter; longest project id wins so prefixes can't steal a match. */
export function matchProject(adName: string, projectIds: string[]): { projectId: string; variantKey?: string } | undefined {
  const name = adName.toLowerCase();
  for (const id of projectIds) {
    const idx = name.indexOf(id.toLowerCase());
    if (idx === -1) continue;
    const rest = adName.slice(idx + id.length);
    const variant = rest.match(/^_((?:h\d+)(?:_c\d+)?(?:_\d+x\d+)?)/i);
    return { projectId: id, variantKey: variant?.[1] };
  }
  return undefined;
}

export interface SyncOptions {
  inboxDir?: string;
  projectIds?: string[];
  weights?: ScoreWeights;
  thresholds?: ScoreThresholds;
  /** Scoring window end (YYYY-MM-DD); defaults to the latest metric date so a stale export still scores. */
  until?: string;
  /** Connected platform adapters; a missing one is simply skipped. */
  meta?: AdPlatformAdapter;
  google?: AdPlatformAdapter;
  /** First sync of an account pulls this many days; later syncs re-pull `refreshDays` (Meta restates ~72 h). */
  backfillDays?: number;
  refreshDays?: number;
  /** Today, for date math in tests. */
  today?: string;
}

const emptyReport = (): SyncReport => ({ files: [], accounts: [], adsScored: 0, winners: 0, losers: 0, fatigued: 0, linked: 0, at: new Date().toISOString() });

/** Imports every new or changed CSV in the inbox. */
export function importInbox(store: PerformanceStore, opts: SyncOptions = {}): FileReport[] {
  const inbox = opts.inboxDir ?? INBOX_DIR;
  fs.mkdirSync(inbox, { recursive: true });
  const projectIds = opts.projectIds ?? knownProjectIds();
  const now = new Date().toISOString();
  const files: FileReport[] = [];

  for (const file of fs.readdirSync(inbox).filter((f) => /\.(csv|tsv)$/i.test(f)).sort()) {
    const text = fs.readFileSync(path.join(inbox, file), "utf8");
    const hash = createHash("sha256").update(text).digest("hex");
    if (store.importRecord(file)?.hash === hash) { files.push({ file, status: "unchanged" }); continue; }
    try {
      const r = importCsv(text, file);
      const accountId = `${r.platform}:${r.accountExternalId}`;
      store.upsertAccount({ id: accountId, platform: r.platform, externalId: r.accountExternalId, name: r.accountName, status: "csv", lastSyncAt: now });
      const dates = r.metrics.map((m) => m.date).sort();
      for (const ad of r.ads) {
        const link = matchProject(ad.name, projectIds);
        const row: PlatformAd = {
          id: `${r.platform}:${ad.externalId}`, accountId, platform: r.platform, externalId: ad.externalId, name: ad.name,
          campaignName: ad.campaignName, adsetName: ad.adsetName, projectId: link?.projectId, variantKey: link?.variantKey,
          firstSeen: dates[0] ?? now.slice(0, 10), lastSeen: dates[dates.length - 1] ?? now.slice(0, 10),
        };
        store.upsertAd(row);
      }
      store.upsertMetrics(r.metrics.map(({ adExternalId, ...m }) => ({ ...m, adId: `${r.platform}:${adExternalId}` })));
      store.recordImport(file, hash, r.platform, r.metrics.length);
      files.push({ file, status: "imported", platform: r.platform, ads: r.ads.length, rows: r.metrics.length, warnings: r.warnings });
    } catch (e) {
      files.push({ file, status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }
  return files;
}

const shiftDate = (ymd: string, days: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

/** Pulls accounts, ads and daily metrics from one platform API. One account failing does not stop the others. */
export async function syncPlatform(store: PerformanceStore, meta: AdPlatformAdapter, opts: SyncOptions = {}): Promise<AccountReport[]> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const projectIds = opts.projectIds ?? knownProjectIds();
  const reports: AccountReport[] = [];
  let accounts;
  try { accounts = await meta.listAccounts(); } catch (e) {
    return [{ accountId: meta.platform, name: meta.platform === "meta" ? "Meta" : "Google Ads", status: "error", error: e instanceof Error ? e.message : String(e) }];
  }
  const known = new Map(store.accounts().map((a) => [a.id, a]));
  for (const account of accounts) {
    const previous = known.get(account.id);
    // Meta's insights lag and restate; "yesterday" is the last complete day.
    const to = shiftDate(today, -1);
    const from = previous?.lastSyncAt
      ? shiftDate(to, -((opts.refreshDays ?? 3) - 1))
      : shiftDate(to, -((opts.backfillDays ?? 90) - 1));
    try {
      const ads = await meta.listAds(account.id, today);
      for (const ad of ads) {
        const link = matchProject(ad.name, projectIds);
        store.upsertAd({ ...ad, projectId: link?.projectId, variantKey: link?.variantKey });
      }
      const metrics = await meta.fetchDailyMetrics(account.id, from, to);
      const knownIds = new Set(ads.map((a) => a.id));
      // Insights can reference deleted ads that /ads no longer lists; keep them visible under their last known name.
      for (const m of metrics) {
        if (knownIds.has(m.adId)) continue;
        knownIds.add(m.adId);
        const name = m.raw?.ad_name ?? m.adId;
        const link = matchProject(name, projectIds);
        store.upsertAd({ id: m.adId, accountId: account.id, platform: meta.platform, externalId: m.adId.replace(/^[a-z]+:/, ""), name, projectId: link?.projectId, variantKey: link?.variantKey, firstSeen: m.date, lastSeen: m.date, status: "ARCHIVED" });
      }
      store.upsertMetrics(metrics);
      store.touchAdsLastSeen(metrics);
      store.upsertAccount({ ...account, lastSyncAt: new Date().toISOString() });
      reports.push({ accountId: account.id, name: account.name, status: "synced", from, to, ads: ads.length, rows: metrics.length });
    } catch (e) {
      store.upsertAccount({ ...account, lastSyncAt: previous?.lastSyncAt });
      reports.push({ accountId: account.id, name: account.name, status: "error", from, to, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return reports;
}

/** Re-links unlinked ads to projects, then recomputes every score. */
export function rescore(store: PerformanceStore, opts: SyncOptions = {}): Pick<SyncReport, "adsScored" | "winners" | "losers" | "fatigued" | "linked"> {
  const projectIds = opts.projectIds ?? knownProjectIds();
  let linked = 0;
  for (const ad of store.ads()) {
    if (ad.projectId) { linked++; continue; }
    const link = matchProject(ad.name, projectIds);
    if (link) { store.linkAdToProject(ad.id, link.projectId, link.variantKey ?? null); linked++; }
  }
  const now = new Date().toISOString();
  const until = opts.until ?? store.latestMetricDate() ?? now.slice(0, 10);
  const scores = computeScores({ totals: store.windowTotals(30, until), recent: store.windowTotals(7, until), weights: opts.weights, thresholds: opts.thresholds, now });
  store.replaceScores(scores);
  store.replaceSuggestions(accountSuggestions(scores, store.ads(), { now }), { scope: "account" });
  evaluateOutcomes(store, now);
  return {
    adsScored: scores.length, linked,
    winners: scores.filter((s) => s.isWinner).length, losers: scores.filter((s) => s.isLoser).length, fatigued: scores.filter((s) => s.isFatigued).length,
  };
}

/** CSV inbox only, then rescore. Kept for tests and for installs without any API. */
export function syncFromInbox(store: PerformanceStore, opts: SyncOptions = {}): SyncReport {
  const report = emptyReport();
  report.files = importInbox(store, opts);
  Object.assign(report, rescore(store, opts));
  return report;
}

/** Everything: inbox CSVs, every connected platform, then one rescore. */
export async function syncAll(store: PerformanceStore, opts: SyncOptions = {}): Promise<SyncReport> {
  const report = emptyReport();
  report.files = importInbox(store, opts);
  if (opts.meta) report.accounts.push(...await syncPlatform(store, opts.meta, opts));
  if (opts.google) report.accounts.push(...await syncPlatform(store, opts.google, opts));
  Object.assign(report, rescore(store, opts));
  return report;
}

/*
 * Nightly scheduler. Checks every few minutes whether today's run (at or after `hour` local time)
 * has happened; the last run date is persisted so a restart doesn't trigger a second run.
 */
export interface NightlyOptions { hour?: number; intervalMs?: number; now?: () => Date }
export function startNightlySync(store: PerformanceStore, run: () => Promise<unknown>, opts: NightlyOptions = {}): { stop: () => void; check: () => Promise<boolean> } {
  const hour = opts.hour ?? 3;
  const now = opts.now ?? (() => new Date());
  let running = false;
  const check = async () => {
    if (running || store.setting("nightlyEnabled", "1") !== "1") return false;
    const t = now();
    const localDate = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    if (t.getHours() < hour || store.setting("nightlyLastRun") === localDate) return false;
    running = true;
    try { await run(); store.setSetting("nightlyLastRun", localDate); store.setSetting("nightlyLastResult", "ok"); }
    catch (e) { store.setSetting("nightlyLastRun", localDate); store.setSetting("nightlyLastResult", e instanceof Error ? e.message : String(e)); }
    finally { running = false; }
    return true;
  };
  const timer = setInterval(() => { void check(); }, opts.intervalMs ?? 5 * 60_000);
  timer.unref?.();
  return { stop: () => clearInterval(timer), check };
}

/** @deprecated use syncPlatform */
export const syncMeta = syncPlatform;
