import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { REPO_ROOT } from "@ai-ads/core";
import type { Pattern } from "./patterns.js";
import type { Suggestion, SuggestionKind, SuggestionStatus } from "./suggest.js";
import type { Teardown } from "./teardown.js";
import type { AdAccount, AdMetricsDaily, AdScore, AdWindowTotals, Platform, PlatformAd, StoredConnection } from "./types.js";

/** Shares the agent queue database so one file holds everything the dashboard learns. */
export const PERFORMANCE_DB_PATH = path.join(REPO_ROOT, "data", "agent-queue", "agent.sqlite");

const METRIC_COLUMNS = [
  "impressions", "reach", "spend", "clicks", "link_clicks", "video_plays_3s", "video_thruplays",
  "video_p25", "video_p50", "video_p75", "video_p100", "views", "view_rate", "conversions", "conversion_value", "leads",
] as const;
const METRIC_FIELDS: Record<(typeof METRIC_COLUMNS)[number], keyof AdMetricsDaily> = {
  impressions: "impressions", reach: "reach", spend: "spend", clicks: "clicks", link_clicks: "linkClicks",
  video_plays_3s: "videoPlays3s", video_thruplays: "videoThruplays", video_p25: "videoP25", video_p50: "videoP50",
  video_p75: "videoP75", video_p100: "videoP100", views: "views", view_rate: "viewRate",
  conversions: "conversions", conversion_value: "conversionValue", leads: "leads",
};

export class PerformanceStore {
  readonly db: DatabaseSync;
  constructor(file = PERFORMANCE_DB_PATH) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS ad_accounts(id TEXT PRIMARY KEY, platform TEXT NOT NULL, external_id TEXT NOT NULL,
        name TEXT NOT NULL, currency TEXT, timezone TEXT, status TEXT NOT NULL, last_sync_at TEXT);
      CREATE TABLE IF NOT EXISTS platform_ads(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, platform TEXT NOT NULL,
        external_id TEXT NOT NULL, name TEXT NOT NULL, campaign_name TEXT, adset_name TEXT, creative_video_url TEXT,
        thumbnail_url TEXT, project_id TEXT, variant_key TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, status TEXT);
      CREATE INDEX IF NOT EXISTS platform_ads_project ON platform_ads(project_id);
      CREATE TABLE IF NOT EXISTS ad_metrics_daily(ad_id TEXT NOT NULL, date TEXT NOT NULL,
        ${METRIC_COLUMNS.map((c) => `${c} REAL`).join(", ")}, raw TEXT, PRIMARY KEY(ad_id, date));
      CREATE TABLE IF NOT EXISTS ad_scores(ad_id TEXT PRIMARY KEY, window_days INTEGER, impressions REAL, spend REAL,
        hook_rate REAL, hold_rate REAL, ctr REAL, cpc REAL, cpa REAL, roas REAL, completion_rate REAL, score REAL,
        percentile REAL, is_winner INTEGER DEFAULT 0, is_loser INTEGER DEFAULT 0, is_fatigued INTEGER DEFAULT 0,
        confidence TEXT, computed_at TEXT);
      CREATE TABLE IF NOT EXISTS ad_teardowns(ad_id TEXT PRIMARY KEY, doc TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS patterns(id TEXT PRIMARY KEY, dimension TEXT NOT NULL, value TEXT NOT NULL, doc TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS suggestions(id TEXT PRIMARY KEY, project_id TEXT, session_id TEXT, kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open', doc TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS perf_imports(file TEXT PRIMARY KEY, hash TEXT NOT NULL, platform TEXT, rows INTEGER, imported_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS perf_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS perf_connections(id TEXT PRIMARY KEY, platform TEXT NOT NULL, doc TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
    // Added after the first release: which connection synced an account.
    try { this.db.exec("ALTER TABLE ad_accounts ADD COLUMN connection_id TEXT"); } catch { /* column exists */ }
  }
  close() { this.db.close(); }

  /** Saved platform connections (tokens included; redact before sending to a browser). */
  connections(): StoredConnection[] {
    return this.db.prepare("SELECT doc FROM perf_connections ORDER BY created_at").all().map((r) => JSON.parse(String(r.doc)));
  }
  connection(id: string): StoredConnection | undefined {
    const r = this.db.prepare("SELECT doc FROM perf_connections WHERE id=?").get(id);
    return r ? JSON.parse(String(r.doc)) : undefined;
  }
  saveConnection(c: StoredConnection) {
    this.db.prepare("INSERT INTO perf_connections(id,platform,doc,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc, updated_at=excluded.updated_at")
      .run(c.id, c.platform, JSON.stringify(c), c.createdAt, c.updatedAt);
  }
  /** Removes the connection; its accounts, ads and metrics stay so the history is not lost. */
  deleteConnection(id: string): boolean {
    const changes = this.db.prepare("DELETE FROM perf_connections WHERE id=?").run(id).changes;
    if (changes) this.db.prepare("UPDATE ad_accounts SET status='disconnected', connection_id=NULL WHERE connection_id=?").run(id);
    return !!changes;
  }

  setting(key: string): string | undefined;
  setting(key: string, fallback: string): string;
  setting(key: string, fallback?: string): string | undefined {
    const r = this.db.prepare("SELECT value FROM perf_settings WHERE key=?").get(key);
    return r ? String(r.value) : fallback;
  }
  setSetting(key: string, value: string) {
    this.db.prepare("INSERT INTO perf_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
  }
  /** Extends `last_seen` (and `first_seen`) of ads to cover the dates of the given metric rows. */
  touchAdsLastSeen(rows: Array<Pick<AdMetricsDaily, "adId" | "date">>) {
    const range = new Map<string, { min: string; max: string }>();
    for (const r of rows) {
      const cur = range.get(r.adId);
      if (!cur) range.set(r.adId, { min: r.date, max: r.date });
      else { if (r.date < cur.min) cur.min = r.date; if (r.date > cur.max) cur.max = r.date; }
    }
    const stmt = this.db.prepare("UPDATE platform_ads SET first_seen=MIN(first_seen,?), last_seen=MAX(last_seen,?) WHERE id=?");
    for (const [id, { min, max }] of range) stmt.run(min, max, id);
  }
  upsertTeardown(t: Teardown) {
    this.db.prepare("INSERT INTO ad_teardowns(ad_id,doc,created_at) VALUES(?,?,?) ON CONFLICT(ad_id) DO UPDATE SET doc=excluded.doc").run(t.adId, JSON.stringify(t), t.createdAt);
  }
  teardown(adId: string): Teardown | undefined {
    const r = this.db.prepare("SELECT doc FROM ad_teardowns WHERE ad_id=?").get(adId);
    return r ? JSON.parse(String(r.doc)) : undefined;
  }
  teardowns(): Teardown[] {
    return this.db.prepare("SELECT doc FROM ad_teardowns ORDER BY created_at DESC").all().map((r) => JSON.parse(String(r.doc)));
  }
  replacePatterns(patterns: Pattern[]) {
    const stmt = this.db.prepare("INSERT INTO patterns(id,dimension,value,doc,updated_at) VALUES(?,?,?,?,?)");
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM patterns");
      for (const p of patterns) stmt.run(p.id, p.dimension, p.value, JSON.stringify(p), p.updatedAt);
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  patterns(): Pattern[] {
    return this.db.prepare("SELECT doc FROM patterns ORDER BY rowid").all().map((r) => JSON.parse(String(r.doc)));
  }
  disabledPatternIds(): Set<string> {
    try { return new Set(JSON.parse(this.setting("disabledPatterns", "[]")) as string[]); } catch { return new Set(); }
  }
  setPatternDisabled(id: string, disabled: boolean) {
    const ids = this.disabledPatternIds();
    if (disabled) ids.add(id); else ids.delete(id);
    this.setSetting("disabledPatterns", JSON.stringify([...ids]));
  }
  /**
   * Replaces the suggestions of one scope: "account" (no project, kinds scale/kill/refresh), "brief"
   * (no project, kinds hook/angle/cta) or one project. Existing accepted/dismissed statuses survive.
   */
  replaceSuggestions(list: Suggestion[], scope: { scope: "account" | "brief" } | { scope: "project"; projectId: string }) {
    const where = scope.scope === "project"
      ? { sql: "project_id=?", args: [scope.projectId] }
      : { sql: `project_id IS NULL AND kind ${scope.scope === "account" ? "IN" : "NOT IN"} ('ad_to_scale','ad_to_kill','refresh_hook')`, args: [] as string[] };
    // Status and everything recorded at acceptance (time, KPI snapshot, measured outcome) survive regeneration.
    const existing = new Map(this.db.prepare(`SELECT doc FROM suggestions WHERE ${where.sql}`).all(...where.args).map((r) => { const d: Suggestion = JSON.parse(String(r.doc)); return [d.id, d]; }));
    const stmt = this.db.prepare("INSERT OR REPLACE INTO suggestions(id,project_id,session_id,kind,status,doc,created_at) VALUES(?,?,?,?,?,?,?)");
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`DELETE FROM suggestions WHERE ${where.sql}`).run(...where.args);
      for (const s of list) {
        const prev = existing.get(s.id);
        const doc: Suggestion = prev ? { ...s, status: prev.status, acceptedAt: prev.acceptedAt, snapshot: prev.snapshot, outcome: prev.outcome, createdAt: prev.createdAt } : s;
        // Only project-scope suggestions live under a project; an account action for a linked ad keeps its projectId in the doc for display.
        stmt.run(s.id, scope.scope === "project" ? scope.projectId : null, s.sessionId ?? null, s.kind, doc.status, JSON.stringify(doc), doc.createdAt);
      }
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  suggestions(filter: { projectId?: string | null; kind?: SuggestionKind | SuggestionKind[]; status?: SuggestionStatus[] } = {}): Suggestion[] {
    const clauses: string[] = []; const args: string[] = [];
    if (filter.projectId === null) clauses.push("project_id IS NULL");
    else if (filter.projectId) { clauses.push("project_id=?"); args.push(filter.projectId); }
    const kinds = filter.kind === undefined ? [] : Array.isArray(filter.kind) ? filter.kind : [filter.kind];
    if (kinds.length) { clauses.push(`kind IN (${kinds.map(() => "?").join(",")})`); args.push(...kinds); }
    if (filter.status?.length) { clauses.push(`status IN (${filter.status.map(() => "?").join(",")})`); args.push(...filter.status); }
    const sql = `SELECT doc FROM suggestions${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY json_extract(doc,'$.score') DESC`;
    return this.db.prepare(sql).all(...args).map((r) => JSON.parse(String(r.doc)));
  }
  setSuggestionStatus(id: string, status: SuggestionStatus, extra: { snapshot?: Suggestion["snapshot"]; at?: string } = {}) {
    const r = this.db.prepare("SELECT doc FROM suggestions WHERE id=?").get(id);
    if (!r) throw new Error("Suggestion not found");
    const prev: Suggestion = JSON.parse(String(r.doc));
    const doc: Suggestion = status === "accepted"
      ? { ...prev, status, acceptedAt: extra.at ?? new Date().toISOString(), snapshot: extra.snapshot ?? prev.snapshot, outcome: undefined }
      : { ...prev, status, acceptedAt: undefined, snapshot: undefined, outcome: undefined };
    this.db.prepare("UPDATE suggestions SET status=?, doc=? WHERE id=?").run(status, JSON.stringify(doc), id);
  }
  setSuggestionOutcome(id: string, outcome: Suggestion["outcome"]) {
    const r = this.db.prepare("SELECT doc FROM suggestions WHERE id=?").get(id);
    if (!r) return;
    this.db.prepare("UPDATE suggestions SET doc=? WHERE id=?").run(JSON.stringify({ ...JSON.parse(String(r.doc)), outcome }), id);
  }
  /**
   * Agent jobs from the shared queue database (the `jobs` table written by the pipeline's AgentStore):
   * which winning patterns each script applied and which project it produced. Empty when the table is absent.
   */
  jobPatternUses(): Array<{ jobId: string; projectId: string; createdAt: string; usedPatternIds: string[] }> {
    try {
      return this.db.prepare("SELECT doc FROM jobs").all().flatMap((r) => {
        const j = JSON.parse(String(r.doc)) as { id?: string; projectId?: string; createdAt?: string; usedPatternIds?: string[] };
        return j.id && j.projectId && j.createdAt && j.usedPatternIds?.length ? [{ jobId: j.id, projectId: j.projectId, createdAt: j.createdAt, usedPatternIds: j.usedPatternIds }] : [];
      });
    } catch { return []; }
  }
  /** Per-project rollup for the Studio: linked ads, 30-day spend and best KPIs. */
  projectSummaries(): Record<string, { ads: number; winners: number; fatigued: number; spend: number; impressions: number; bestHookRate?: number; bestCtr?: number; bestVariantKey?: string }> {
    const out: ReturnType<PerformanceStore["projectSummaries"]> = {};
    const rows = this.db.prepare(`SELECT a.project_id, a.variant_key, s.* FROM platform_ads a JOIN ad_scores s ON s.ad_id=a.id WHERE a.project_id IS NOT NULL ORDER BY s.score DESC`).all();
    for (const r of rows) {
      const pid = String(r.project_id);
      const cur = out[pid] ?? (out[pid] = { ads: 0, winners: 0, fatigued: 0, spend: 0, impressions: 0 });
      cur.ads++; cur.spend += Number(r.spend ?? 0); cur.impressions += Number(r.impressions ?? 0);
      if (r.is_winner) cur.winners++; if (r.is_fatigued) cur.fatigued++;
      if (r.hook_rate !== null && (cur.bestHookRate === undefined || Number(r.hook_rate) > cur.bestHookRate)) cur.bestHookRate = Number(r.hook_rate);
      if (r.ctr !== null && (cur.bestCtr === undefined || Number(r.ctr) > cur.bestCtr)) cur.bestCtr = Number(r.ctr);
      if (cur.bestVariantKey === undefined && r.variant_key) cur.bestVariantKey = String(r.variant_key);
    }
    return out;
  }

  upsertAccount(a: AdAccount) {
    this.db.prepare(`INSERT INTO ad_accounts(id,platform,external_id,name,currency,timezone,status,last_sync_at,connection_id) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, status=excluded.status, last_sync_at=COALESCE(excluded.last_sync_at, ad_accounts.last_sync_at),
      currency=COALESCE(excluded.currency, ad_accounts.currency), timezone=COALESCE(excluded.timezone, ad_accounts.timezone),
      connection_id=COALESCE(excluded.connection_id, ad_accounts.connection_id)`)
      .run(a.id, a.platform, a.externalId, a.name, a.currency ?? null, a.timezone ?? null, a.status, a.lastSyncAt ?? null, a.connectionId ?? null);
  }
  accounts(): AdAccount[] {
    return this.db.prepare("SELECT * FROM ad_accounts ORDER BY platform, name").all().map((r) => ({
      id: String(r.id), platform: r.platform as Platform, externalId: String(r.external_id), name: String(r.name),
      currency: r.currency ? String(r.currency) : undefined, timezone: r.timezone ? String(r.timezone) : undefined,
      status: r.status as AdAccount["status"], lastSyncAt: r.last_sync_at ? String(r.last_sync_at) : undefined,
      connectionId: r.connection_id ? String(r.connection_id) : undefined,
    }));
  }

  upsertAd(ad: PlatformAd) {
    this.db.prepare(`INSERT INTO platform_ads(id,account_id,platform,external_id,name,campaign_name,adset_name,creative_video_url,thumbnail_url,project_id,variant_key,first_seen,last_seen,status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, campaign_name=COALESCE(excluded.campaign_name, platform_ads.campaign_name),
        adset_name=COALESCE(excluded.adset_name, platform_ads.adset_name), creative_video_url=COALESCE(excluded.creative_video_url, platform_ads.creative_video_url),
        thumbnail_url=COALESCE(excluded.thumbnail_url, platform_ads.thumbnail_url), project_id=COALESCE(platform_ads.project_id, excluded.project_id),
        variant_key=COALESCE(platform_ads.variant_key, excluded.variant_key), first_seen=MIN(platform_ads.first_seen, excluded.first_seen),
        last_seen=MAX(platform_ads.last_seen, excluded.last_seen), status=COALESCE(excluded.status, platform_ads.status)`)
      .run(ad.id, ad.accountId, ad.platform, ad.externalId, ad.name, ad.campaignName ?? null, ad.adsetName ?? null, ad.creativeVideoUrl ?? null,
        ad.thumbnailUrl ?? null, ad.projectId ?? null, ad.variantKey ?? null, ad.firstSeen, ad.lastSeen, ad.status ?? null);
  }
  ads(): PlatformAd[] {
    return this.db.prepare("SELECT * FROM platform_ads ORDER BY last_seen DESC").all().map(rowToAd);
  }
  ad(id: string): PlatformAd | undefined {
    const r = this.db.prepare("SELECT * FROM platform_ads WHERE id=?").get(id);
    return r ? rowToAd(r) : undefined;
  }
  /** Manual link from the UI; empty projectId clears it. */
  linkAdToProject(adId: string, projectId: string | null, variantKey: string | null = null) {
    const info = this.db.prepare("UPDATE platform_ads SET project_id=?, variant_key=? WHERE id=?").run(projectId, variantKey, adId);
    if (!info.changes) throw new Error("Ad not found");
  }

  upsertMetrics(rows: AdMetricsDaily[]) {
    const sql = `INSERT INTO ad_metrics_daily(ad_id,date,${METRIC_COLUMNS.join(",")},raw) VALUES(?,?,${METRIC_COLUMNS.map(() => "?").join(",")},?)
      ON CONFLICT(ad_id,date) DO UPDATE SET ${METRIC_COLUMNS.map((c) => `${c}=COALESCE(excluded.${c}, ad_metrics_daily.${c})`).join(", ")}, raw=COALESCE(excluded.raw, ad_metrics_daily.raw)`;
    const stmt = this.db.prepare(sql);
    this.db.exec("BEGIN");
    try {
      for (const m of rows) {
        stmt.run(m.adId, m.date, ...METRIC_COLUMNS.map((c) => { const v = m[METRIC_FIELDS[c]]; return typeof v === "number" ? v : null; }), m.raw ? JSON.stringify(m.raw) : null);
      }
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  /** Sum of each ad's metrics over the last `days` days ending at `until` (inclusive). */
  windowTotals(days: number, until = new Date().toISOString().slice(0, 10)): AdWindowTotals[] {
    const from = new Date(`${until}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - (days - 1));
    const rows = this.db.prepare(`SELECT a.id ad_id, a.account_id, a.platform,
        SUM(m.impressions) impressions, SUM(m.spend) spend, SUM(m.clicks) clicks, SUM(m.link_clicks) link_clicks,
        SUM(m.video_plays_3s) video_plays_3s, SUM(m.video_thruplays) video_thruplays, SUM(m.video_p25) video_p25, SUM(m.video_p100) video_p100,
        SUM(m.views) views, SUM(m.conversions) conversions, SUM(m.conversion_value) conversion_value, COUNT(*) n
      FROM platform_ads a JOIN ad_metrics_daily m ON m.ad_id=a.id WHERE m.date BETWEEN ? AND ? GROUP BY a.id`)
      .all(from.toISOString().slice(0, 10), until);
    const opt = (v: unknown) => (v === null || v === undefined ? undefined : Number(v));
    return rows.map((r) => ({
      adId: String(r.ad_id), accountId: String(r.account_id), platform: r.platform as Platform, days,
      impressions: Number(r.impressions ?? 0), spend: Number(r.spend ?? 0), clicks: Number(r.clicks ?? 0), linkClicks: Number(r.link_clicks ?? 0),
      videoPlays3s: opt(r.video_plays_3s), videoThruplays: opt(r.video_thruplays), videoP25: opt(r.video_p25), videoP100: opt(r.video_p100),
      views: opt(r.views), conversions: opt(r.conversions), conversionValue: opt(r.conversion_value),
    }));
  }
  latestMetricDate(): string | undefined {
    const r = this.db.prepare("SELECT MAX(date) d FROM ad_metrics_daily").get();
    return r?.d ? String(r.d) : undefined;
  }
  dailySeries(adId: string, days = 30): Array<{ date: string; impressions?: number; spend?: number; hookRate?: number; ctr?: number }> {
    return this.db.prepare("SELECT date, impressions, spend, video_plays_3s, views, link_clicks, clicks FROM ad_metrics_daily WHERE ad_id=? ORDER BY date DESC LIMIT ?")
      .all(adId, days).reverse().map((r) => {
        const imp = r.impressions === null ? undefined : Number(r.impressions);
        const plays = r.video_plays_3s ?? r.views;
        const clicks = r.link_clicks ?? r.clicks;
        return {
          date: String(r.date), impressions: imp, spend: r.spend === null ? undefined : Number(r.spend),
          hookRate: imp && plays !== null ? Number(plays) / imp : undefined, ctr: imp && clicks !== null ? Number(clicks) / imp : undefined,
        };
      });
  }

  replaceScores(scores: AdScore[]) {
    const stmt = this.db.prepare(`INSERT OR REPLACE INTO ad_scores(ad_id,window_days,impressions,spend,hook_rate,hold_rate,ctr,cpc,cpa,roas,completion_rate,score,percentile,is_winner,is_loser,is_fatigued,confidence,computed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM ad_scores");
      for (const s of scores) {
        stmt.run(s.adId, s.windowDays, s.impressions, s.spend, s.hookRate ?? null, s.holdRate ?? null, s.ctr ?? null, s.cpc ?? null, s.cpa ?? null,
          s.roas ?? null, s.completionRate ?? null, s.score, s.percentile, s.isWinner ? 1 : 0, s.isLoser ? 1 : 0, s.isFatigued ? 1 : 0, s.confidence, s.computedAt);
      }
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  scores(): AdScore[] {
    const opt = (v: unknown) => (v === null || v === undefined ? undefined : Number(v));
    return this.db.prepare("SELECT * FROM ad_scores ORDER BY score DESC").all().map((r) => ({
      adId: String(r.ad_id), windowDays: Number(r.window_days), impressions: Number(r.impressions), spend: Number(r.spend),
      hookRate: opt(r.hook_rate), holdRate: opt(r.hold_rate), ctr: opt(r.ctr), cpc: opt(r.cpc), cpa: opt(r.cpa), roas: opt(r.roas),
      completionRate: opt(r.completion_rate), score: Number(r.score), percentile: Number(r.percentile),
      isWinner: !!r.is_winner, isLoser: !!r.is_loser, isFatigued: !!r.is_fatigued, confidence: r.confidence as AdScore["confidence"], computedAt: String(r.computed_at),
    }));
  }

  importRecord(file: string): { hash: string; importedAt: string } | undefined {
    const r = this.db.prepare("SELECT hash, imported_at FROM perf_imports WHERE file=?").get(file);
    return r ? { hash: String(r.hash), importedAt: String(r.imported_at) } : undefined;
  }
  recordImport(file: string, hash: string, platform: Platform, rows: number) {
    this.db.prepare("INSERT OR REPLACE INTO perf_imports(file,hash,platform,rows,imported_at) VALUES(?,?,?,?,?)").run(file, hash, platform, rows, new Date().toISOString());
  }
  imports(): Array<{ file: string; platform?: Platform; rows: number; importedAt: string }> {
    return this.db.prepare("SELECT file, platform, rows, imported_at FROM perf_imports ORDER BY imported_at DESC").all()
      .map((r) => ({ file: String(r.file), platform: r.platform ? (r.platform as Platform) : undefined, rows: Number(r.rows ?? 0), importedAt: String(r.imported_at) }));
  }
}

function rowToAd(r: Record<string, unknown>): PlatformAd {
  const s = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
  return {
    id: String(r.id), accountId: String(r.account_id), platform: r.platform as Platform, externalId: String(r.external_id), name: String(r.name),
    campaignName: s(r.campaign_name), adsetName: s(r.adset_name), creativeVideoUrl: s(r.creative_video_url), thumbnailUrl: s(r.thumbnail_url),
    projectId: s(r.project_id), variantKey: s(r.variant_key), firstSeen: String(r.first_seen), lastSeen: String(r.last_seen), status: s(r.status),
  };
}
