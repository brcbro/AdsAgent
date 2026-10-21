import type { AdAccount, AdMetricsDaily, PlatformAd } from "../types.js";

/*
 * Google Ads adapter over the REST API (GAQL via `googleAds:search`), read-only. Auth is an OAuth
 * refresh token plus the developer token; the access token is refreshed on demand. Video ads have
 * no 3-second metric, so view rate stands in for the hook rate and the quartile rates (fractions of
 * impressions) are turned into counts so the shared scorer can use p100 ÷ p25 as hold rate.
 */

export interface GoogleAdsConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Customer ids, digits only or with dashes. */
  customerIds: string[];
  /** Manager (MCC) account the token belongs to, when the customers are accessed through one. */
  loginCustomerId?: string;
  apiVersion: string;
}

export function googleConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GoogleAdsConfig | undefined {
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim(), clientId = env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_ADS_CLIENT_SECRET?.trim(), refreshToken = env.GOOGLE_ADS_REFRESH_TOKEN?.trim();
  const customerIds = (env.GOOGLE_ADS_CUSTOMER_IDS ?? "").split(/[,\s]+/).map(customerId).filter(Boolean);
  if (!developerToken || !clientId || !clientSecret || !refreshToken || !customerIds.length) return undefined;
  const login = env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim();
  return { developerToken, clientId, clientSecret, refreshToken, customerIds, loginCustomerId: login ? customerId(login) : undefined, apiVersion: env.GOOGLE_ADS_API_VERSION?.trim() || "v19" };
}

export const customerId = (id: string) => id.replace(/\D/g, "");

/** The shape `googleAds:search` returns for the fields we ask for (camelCase, numbers as strings). */
export interface GoogleAdRow {
  adGroupAd?: { ad?: { id?: string; name?: string; type?: string }; status?: string };
  campaign?: { id?: string; name?: string };
  adGroup?: { id?: string; name?: string };
  segments?: { date?: string };
  metrics?: {
    impressions?: string; costMicros?: string; clicks?: string; videoViews?: string; videoViewRate?: number | string;
    videoQuartileP25Rate?: number | string; videoQuartileP50Rate?: number | string; videoQuartileP75Rate?: number | string; videoQuartileP100Rate?: number | string;
    conversions?: number | string; conversionsValue?: number | string;
  };
}

const num = (v: string | number | undefined): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export const AD_QUERY = "SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.status, campaign.id, campaign.name, ad_group.id, ad_group.name FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'";
export const metricsQuery = (since: string, until: string) =>
  `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, campaign.name, ad_group.name, segments.date, metrics.impressions, metrics.cost_micros, metrics.clicks, metrics.video_views, metrics.video_view_rate, metrics.video_quartile_p25_rate, metrics.video_quartile_p50_rate, metrics.video_quartile_p75_rate, metrics.video_quartile_p100_rate, metrics.conversions, metrics.conversions_value FROM ad_group_ad WHERE segments.date BETWEEN '${since}' AND '${until}' AND metrics.impressions > 0`;

/** Google ads are often unnamed; fall back to campaign / ad group / id so the leaderboard stays readable. */
export function adDisplayName(row: GoogleAdRow): string {
  const name = row.adGroupAd?.ad?.name?.trim();
  if (name) return name;
  return [row.campaign?.name, row.adGroup?.name, row.adGroupAd?.ad?.id].filter(Boolean).join(" / ") || String(row.adGroupAd?.ad?.id ?? "unknown");
}

export function mapGoogleAd(row: GoogleAdRow, accountId: string, seen: string): PlatformAd {
  const id = String(row.adGroupAd?.ad?.id ?? "");
  return {
    id: `google:${id}`, accountId, platform: "google", externalId: id, name: adDisplayName(row),
    campaignName: row.campaign?.name, adsetName: row.adGroup?.name, firstSeen: seen, lastSeen: seen, status: row.adGroupAd?.status,
  };
}

export function mapGoogleMetrics(row: GoogleAdRow): AdMetricsDaily {
  const m = row.metrics ?? {};
  const impressions = num(m.impressions);
  const quartile = (rate: number | string | undefined) => {
    const r = num(rate);
    return r === undefined || impressions === undefined ? undefined : Math.round(r * impressions);
  };
  const costMicros = num(m.costMicros);
  return {
    adId: `google:${row.adGroupAd?.ad?.id}`, date: row.segments?.date ?? "",
    impressions, spend: costMicros === undefined ? undefined : costMicros / 1_000_000, clicks: num(m.clicks),
    views: num(m.videoViews), viewRate: num(m.videoViewRate),
    videoP25: quartile(m.videoQuartileP25Rate), videoP50: quartile(m.videoQuartileP50Rate), videoP75: quartile(m.videoQuartileP75Rate), videoP100: quartile(m.videoQuartileP100Rate),
    conversions: num(m.conversions), conversionValue: num(m.conversionsValue),
    raw: { ad_name: adDisplayName(row), campaign: row.campaign?.name ?? "", ad_group: row.adGroup?.name ?? "" },
  };
}

export class GoogleAdsApiError extends Error {
  constructor(message: string, readonly status?: number, readonly reason?: string) { super(message); this.name = "GoogleAdsApiError"; }
  get rateLimited() { return this.status === 429 || this.reason === "RESOURCE_EXHAUSTED"; }
}

export class GoogleAdsAdapter {
  readonly platform = "google" as const;
  private token?: { value: string; expiresAt: number };
  constructor(
    private readonly cfg: GoogleAdsConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    private readonly now = () => Date.now(),
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now() + 60_000) return this.token.value;
    const res = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(30_000),
      body: new URLSearchParams({ client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, refresh_token: this.cfg.refreshToken, grant_type: "refresh_token" }),
    });
    const body = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !body.access_token) throw new GoogleAdsApiError(`Google OAuth: ${body.error_description ?? body.error ?? res.statusText}`, res.status, body.error);
    this.token = { value: body.access_token, expiresAt: this.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  /** Runs a GAQL query, following page tokens (page size is fixed by the API since v17); retries documented rate limits. */
  private async search(customer: string, query: string, attempt = 0): Promise<GoogleAdRow[]> {
    const token = await this.accessToken();
    const url = `https://googleads.googleapis.com/${this.cfg.apiVersion}/customers/${customerId(customer)}/googleAds:search`;
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "developer-token": this.cfg.developerToken, "Content-Type": "application/json" };
    if (this.cfg.loginCustomerId) headers["login-customer-id"] = this.cfg.loginCustomerId;
    const out: GoogleAdRow[] = [];
    let pageToken: string | undefined;
    let guard = 0;
    do {
      const res = await this.fetchImpl(url, { method: "POST", headers, signal: AbortSignal.timeout(90_000), body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }) });
      const text = await res.text();
      let body: { results?: GoogleAdRow[]; nextPageToken?: string; error?: { message?: string; status?: string; details?: Array<{ errors?: Array<{ message?: string }> }> } };
      try { body = JSON.parse(text); } catch { throw new GoogleAdsApiError(`Google Ads ${res.status}: ${text.slice(0, 200)}`, res.status); }
      if (!res.ok || body.error) {
        const detail = body.error?.details?.flatMap((d) => d.errors ?? []).map((e) => e.message).filter(Boolean).join("; ");
        const err = new GoogleAdsApiError(`Google Ads API: ${detail || body.error?.message || res.statusText}`, res.status, body.error?.status);
        if (err.rateLimited && attempt < 3) { await this.sleep(30_000 * (attempt + 1)); return this.search(customer, query, attempt + 1); }
        throw err;
      }
      out.push(...(body.results ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken && guard++ < 500);
    return out;
  }

  async listAccounts(): Promise<AdAccount[]> {
    const accounts: AdAccount[] = [];
    for (const id of this.cfg.customerIds) {
      const rows = await this.search(id, "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer") as Array<{ customer?: { id?: string; descriptiveName?: string; currencyCode?: string; timeZone?: string } }>;
      const c = rows[0]?.customer ?? {};
      accounts.push({ id: `google:${id}`, platform: "google", externalId: id, name: c.descriptiveName ?? `Google Ads ${id}`, currency: c.currencyCode, timezone: c.timeZone, status: "connected" });
    }
    return accounts;
  }

  async listAds(accountId: string, seen = new Date().toISOString().slice(0, 10)): Promise<PlatformAd[]> {
    const customer = accountId.replace(/^google:/, "");
    const rows = await this.search(customer, AD_QUERY);
    return rows.filter((r) => r.adGroupAd?.ad?.id).map((r) => mapGoogleAd(r, `google:${customerId(customer)}`, seen));
  }

  async fetchDailyMetrics(accountId: string, from: string, to: string): Promise<AdMetricsDaily[]> {
    const rows = await this.search(accountId.replace(/^google:/, ""), metricsQuery(from, to));
    return rows.filter((r) => r.adGroupAd?.ad?.id && r.segments?.date).map(mapGoogleMetrics);
  }
}
