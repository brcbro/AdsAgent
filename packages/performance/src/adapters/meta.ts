import type { AdAccount, AdMetricsDaily, PlatformAd } from "../types.js";

/*
 * Meta Marketing API (Graph API) adapter. Read-only: ad accounts, ads with creatives, and daily
 * ad-level insights. Needs a system-user token with `ads_read` on the account(s).
 * Every request goes through an injectable `fetch`, so the mapping is tested without the network.
 */

export interface MetaConfig {
  accessToken: string;
  /** Ad account ids, with or without the `act_` prefix. */
  accountIds: string[];
  apiVersion: string;
  /** Action types that count as a conversion, first present wins. */
  conversionActions: string[];
  leadActions: string[];
}

export const DEFAULT_CONVERSION_ACTIONS = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase", "onsite_conversion.purchase"];
export const DEFAULT_LEAD_ACTIONS = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];

export function metaConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MetaConfig | undefined {
  const accessToken = env.META_ACCESS_TOKEN?.trim();
  const accountIds = (env.META_AD_ACCOUNT_IDS ?? "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  if (!accessToken || !accountIds.length) return undefined;
  const list = (v: string | undefined, fallback: string[]) => (v?.trim() ? v.split(",").map((s) => s.trim()).filter(Boolean) : fallback);
  return {
    accessToken, accountIds, apiVersion: env.META_API_VERSION?.trim() || "v21.0",
    conversionActions: list(env.META_CONVERSION_ACTIONS, DEFAULT_CONVERSION_ACTIONS),
    leadActions: list(env.META_LEAD_ACTIONS, DEFAULT_LEAD_ACTIONS),
  };
}

export const actId = (id: string) => (id.startsWith("act_") ? id : `act_${id}`);

type ActionList = Array<{ action_type: string; value: string }>;
export interface MetaInsightRow {
  ad_id: string; ad_name?: string; date_start: string; date_stop?: string;
  impressions?: string; reach?: string; spend?: string; clicks?: string; inline_link_clicks?: string;
  actions?: ActionList; action_values?: ActionList;
  video_play_actions?: ActionList; video_thruplay_watched_actions?: ActionList;
  video_p25_watched_actions?: ActionList; video_p50_watched_actions?: ActionList;
  video_p75_watched_actions?: ActionList; video_p100_watched_actions?: ActionList;
}
export interface MetaAdRow {
  id: string; name: string; status?: string; effective_status?: string;
  campaign?: { id?: string; name?: string }; adset?: { id?: string; name?: string };
  creative?: { id?: string; video_id?: string; thumbnail_url?: string };
}

const num = (v: string | number | undefined): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
/** Meta's video metrics are lists of one `video_view` action; totals are their sum. */
const actionTotal = (list: ActionList | undefined): number | undefined =>
  list?.length ? list.reduce((a, x) => a + (num(x.value) ?? 0), 0) : undefined;
const pickAction = (list: ActionList | undefined, preferred: string[]): number | undefined => {
  if (!list?.length) return undefined;
  for (const type of preferred) {
    const hit = list.find((a) => a.action_type === type);
    if (hit) return num(hit.value);
  }
  return undefined;
};

export const INSIGHT_FIELDS = [
  "ad_id", "ad_name", "date_start", "date_stop", "impressions", "reach", "spend", "clicks", "inline_link_clicks",
  "actions", "action_values", "video_play_actions", "video_thruplay_watched_actions",
  "video_p25_watched_actions", "video_p50_watched_actions", "video_p75_watched_actions", "video_p100_watched_actions",
].join(",");
export const AD_FIELDS = "id,name,status,effective_status,campaign{id,name},adset{id,name},creative{id,video_id,thumbnail_url}";

export function mapInsightRow(row: MetaInsightRow, cfg: Pick<MetaConfig, "conversionActions" | "leadActions">): AdMetricsDaily {
  return {
    adId: `meta:${row.ad_id}`, date: row.date_start,
    impressions: num(row.impressions), reach: num(row.reach), spend: num(row.spend),
    clicks: num(row.clicks), linkClicks: num(row.inline_link_clicks),
    videoPlays3s: actionTotal(row.video_play_actions), videoThruplays: actionTotal(row.video_thruplay_watched_actions),
    videoP25: actionTotal(row.video_p25_watched_actions), videoP50: actionTotal(row.video_p50_watched_actions),
    videoP75: actionTotal(row.video_p75_watched_actions), videoP100: actionTotal(row.video_p100_watched_actions),
    conversions: pickAction(row.actions, cfg.conversionActions), conversionValue: pickAction(row.action_values, cfg.conversionActions),
    leads: pickAction(row.actions, cfg.leadActions),
    raw: Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])),
  };
}

export function mapAdRow(row: MetaAdRow, accountId: string, seen: string): PlatformAd {
  return {
    id: `meta:${row.id}`, accountId, platform: "meta", externalId: row.id, name: row.name,
    campaignName: row.campaign?.name, adsetName: row.adset?.name,
    thumbnailUrl: row.creative?.thumbnail_url, creativeVideoUrl: row.creative?.video_id ? `meta-video:${row.creative.video_id}` : undefined,
    firstSeen: seen, lastSeen: seen, status: row.effective_status ?? row.status,
  };
}

/** Splits [from, to] into chunks of at most `days` days (Meta restates and paginates better on short ranges). */
export function dateChunks(from: string, to: string, days = 30): Array<{ since: string; until: string }> {
  const out: Array<{ since: string; until: string }> = [];
  let start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (start <= end) {
    const stop = new Date(start); stop.setUTCDate(stop.getUTCDate() + days - 1);
    const until = stop > end ? end : stop;
    out.push({ since: start.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) });
    start = new Date(until); start.setUTCDate(start.getUTCDate() + 1);
  }
  return out;
}

export class MetaApiError extends Error {
  constructor(message: string, readonly code?: number, readonly status?: number) { super(message); this.name = "MetaApiError"; }
  /** Codes 4, 17, 32 and 613 are the documented rate limits. */
  get rateLimited() { return [4, 17, 32, 613].includes(this.code ?? -1); }
}

export class MetaAdapter {
  readonly platform = "meta" as const;
  constructor(private readonly cfg: MetaConfig, private readonly fetchImpl: typeof fetch = fetch, private readonly sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) {}

  private get base() { return `https://graph.facebook.com/${this.cfg.apiVersion}`; }

  private async get<T>(pathOrUrl: string, params: Record<string, string> = {}, attempt = 0): Promise<T> {
    const url = new URL(pathOrUrl.startsWith("http") ? pathOrUrl : `${this.base}/${pathOrUrl}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", this.cfg.accessToken);
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(90_000) });
    const text = await res.text();
    let body: { error?: { message?: string; code?: number; error_subcode?: number } } & T;
    try { body = JSON.parse(text); } catch { throw new MetaApiError(`Meta ${res.status}: ${text.slice(0, 200)}`, undefined, res.status); }
    if (!res.ok || body.error) {
      const err = new MetaApiError(`Meta API: ${body.error?.message ?? res.statusText} (code ${body.error?.code ?? res.status})`, body.error?.code, res.status);
      if (err.rateLimited && attempt < 3) { await this.sleep(30_000 * (attempt + 1)); return this.get<T>(pathOrUrl, params, attempt + 1); }
      throw err;
    }
    return body;
  }

  /** Follows `paging.next` until exhausted. */
  private async getAll<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    let page = await this.get<{ data: T[]; paging?: { next?: string } }>(path, params);
    out.push(...page.data);
    let guard = 0;
    while (page.paging?.next && guard++ < 500) {
      page = await this.get<{ data: T[]; paging?: { next?: string } }>(page.paging.next);
      out.push(...page.data);
    }
    return out;
  }

  async listAccounts(): Promise<AdAccount[]> {
    const accounts: AdAccount[] = [];
    for (const raw of this.cfg.accountIds) {
      const id = actId(raw);
      const a = await this.get<{ id: string; name?: string; currency?: string; timezone_name?: string; account_status?: number }>(id, { fields: "id,name,currency,timezone_name,account_status" });
      accounts.push({ id: `meta:${a.id.replace(/^act_/, "")}`, platform: "meta", externalId: a.id.replace(/^act_/, ""), name: a.name ?? a.id, currency: a.currency, timezone: a.timezone_name, status: "connected" });
    }
    return accounts;
  }

  async listAds(accountId: string, seen = new Date().toISOString().slice(0, 10)): Promise<PlatformAd[]> {
    const rows = await this.getAll<MetaAdRow>(`${actId(accountId.replace(/^meta:/, ""))}/ads`, { fields: AD_FIELDS, limit: "200" });
    return rows.map((r) => mapAdRow(r, `meta:${accountId.replace(/^meta:/, "").replace(/^act_/, "")}`, seen));
  }

  async fetchDailyMetrics(accountId: string, from: string, to: string): Promise<AdMetricsDaily[]> {
    const out: AdMetricsDaily[] = [];
    for (const chunk of dateChunks(from, to)) {
      const rows = await this.getAll<MetaInsightRow>(`${actId(accountId.replace(/^meta:/, ""))}/insights`, {
        level: "ad", time_increment: "1", fields: INSIGHT_FIELDS, limit: "500",
        time_range: JSON.stringify(chunk),
      });
      out.push(...rows.map((r) => mapInsightRow(r, this.cfg)));
    }
    return out;
  }

  /** Direct MP4 of an ad's video, for teardown in a later step. Needs the account's video read permission. */
  async fetchCreativeVideoUrl(adId: string): Promise<string | null> {
    const ad = await this.get<{ creative?: { video_id?: string } }>(adId.replace(/^meta:/, ""), { fields: "creative{video_id}" });
    const videoId = ad.creative?.video_id;
    if (!videoId) return null;
    const video = await this.get<{ source?: string }>(videoId, { fields: "source" });
    return video.source ?? null;
  }
}
