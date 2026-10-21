import assert from "node:assert/strict";
import test from "node:test";
import { GoogleAdsAdapter, GoogleAdsApiError, adDisplayName, customerId, googleConfigFromEnv, mapGoogleMetrics, metricsQuery, type GoogleAdsConfig } from "./google.js";

const cfg: GoogleAdsConfig = { developerToken: "dev", clientId: "cid", clientSecret: "sec", refreshToken: "rt", customerIds: ["1234567890"], loginCustomerId: "9999999999", apiVersion: "v19" };

test("Env config needs all four credentials and a customer id; dashes are stripped", () => {
  assert.equal(googleConfigFromEnv({}), undefined);
  assert.equal(googleConfigFromEnv({ GOOGLE_ADS_DEVELOPER_TOKEN: "d", GOOGLE_ADS_CLIENT_ID: "c", GOOGLE_ADS_CLIENT_SECRET: "s", GOOGLE_ADS_REFRESH_TOKEN: "r" }), undefined);
  const c = googleConfigFromEnv({ GOOGLE_ADS_DEVELOPER_TOKEN: "d", GOOGLE_ADS_CLIENT_ID: "c", GOOGLE_ADS_CLIENT_SECRET: "s", GOOGLE_ADS_REFRESH_TOKEN: "r", GOOGLE_ADS_CUSTOMER_IDS: "123-456-7890, 111", GOOGLE_ADS_LOGIN_CUSTOMER_ID: "999-999-9999" })!;
  assert.deepEqual(c.customerIds, ["1234567890", "111"]); assert.equal(c.loginCustomerId, "9999999999"); assert.equal(c.apiVersion, "v19");
  assert.equal(customerId("123-456-7890"), "1234567890");
});

test("Metrics rows map cost micros, view rate and quartile rates into the shared shape; unnamed ads get a readable name", () => {
  const row = {
    adGroupAd: { ad: { id: "777" }, status: "ENABLED" }, campaign: { name: "DE Video" }, adGroup: { name: "Group 1" }, segments: { date: "2026-10-19" },
    metrics: { impressions: "20000", costMicros: "210500000", clicks: "300", videoViews: "6000", videoViewRate: 0.3, videoQuartileP25Rate: 0.45, videoQuartileP100Rate: "0.125", conversions: 5, conversionsValue: 450 },
  };
  const m = mapGoogleMetrics(row);
  assert.equal(m.adId, "google:777"); assert.equal(m.date, "2026-10-19"); assert.equal(m.impressions, 20_000); assert.equal(m.spend, 210.5);
  assert.equal(m.views, 6000); assert.equal(m.viewRate, 0.3); assert.equal(m.videoP25, 9000); assert.equal(m.videoP100, 2500); assert.equal(m.videoP50, undefined);
  assert.equal(m.conversions, 5); assert.equal(m.conversionValue, 450); assert.equal(m.raw?.ad_name, "DE Video / Group 1 / 777");
  assert.equal(adDisplayName({ adGroupAd: { ad: { id: "1", name: "  YT Hook A " } } }), "YT Hook A");
  assert.match(metricsQuery("2026-10-01", "2026-10-03"), /segments\.date BETWEEN '2026-10-01' AND '2026-10-03'/);
});

function fakeFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const { status = 200, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetch: f, calls };
}

test("Adapter refreshes the OAuth token once, sends developer and login headers, pages through results, and keeps secrets out of errors", async () => {
  let tokenCalls = 0;
  const { fetch, calls } = fakeFetch((url, init) => {
    if (url.startsWith("https://oauth2.googleapis.com/token")) { tokenCalls++; return { body: { access_token: "at-1", expires_in: 3600 } }; }
    const body = JSON.parse(String(init?.body));
    if (body.query.startsWith("SELECT customer.id")) return { body: { results: [{ customer: { id: "1234567890", descriptiveName: "Trading DE", currencyCode: "EUR", timeZone: "Europe/Berlin" } }] } };
    if (body.query.startsWith("SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type")) {
      if (!body.pageToken) return { body: { results: [{ adGroupAd: { ad: { id: "1", name: "proj_h1_c1" }, status: "ENABLED" }, campaign: { name: "C" }, adGroup: { name: "G" } }], nextPageToken: "p2" } };
      return { body: { results: [{ adGroupAd: { ad: { id: "2" } }, campaign: { name: "C" }, adGroup: { name: "G" } }] } };
    }
    if (body.query.includes("BETWEEN 'bad'")) return { status: 400, body: { error: { message: "Request contains an invalid argument.", status: "INVALID_ARGUMENT", details: [{ errors: [{ message: "Unrecognized field: bad" }] }] } } };
    if (body.query.includes("segments.date BETWEEN")) return { body: { results: [{ adGroupAd: { ad: { id: "1" } }, segments: { date: "2026-10-01" }, metrics: { impressions: "10", costMicros: "1500000", videoViews: "4" } }] } };
    return { status: 400, body: { error: { message: "Request contains an invalid argument.", status: "INVALID_ARGUMENT", details: [{ errors: [{ message: "Unrecognized field" }] }] } } };
  });
  const google = new GoogleAdsAdapter(cfg, fetch);
  const accounts = await google.listAccounts();
  assert.deepEqual(accounts.map((a) => [a.id, a.name, a.currency, a.status]), [["google:1234567890", "Trading DE", "EUR", "connected"]]);
  const ads = await google.listAds("google:1234567890", "2026-10-21");
  assert.equal(ads.length, 2); assert.equal(ads[0].id, "google:1", ); assert.equal(ads[0].accountId, "google:1234567890"); assert.equal(ads[1].name, "C / G / 2");
  const metrics = await google.fetchDailyMetrics("google:1234567890", "2026-10-01", "2026-10-03");
  assert.equal(metrics.length, 1); assert.equal(metrics[0].spend, 1.5); assert.equal(metrics[0].views, 4);
  assert.equal(tokenCalls, 1, "token cached across calls");
  const search = calls.find((c) => c.url.includes("googleAds:search"))!;
  assert.equal(search.url, "https://googleads.googleapis.com/v19/customers/1234567890/googleAds:search");
  const headers = search.init?.headers as Record<string, string>;
  assert.ok(!("pageSize" in JSON.parse(String(search.init?.body))), "page size is fixed by the API since v17");
  assert.equal(headers["developer-token"], "dev"); assert.equal(headers["login-customer-id"], "9999999999"); assert.equal(headers.Authorization, "Bearer at-1");
  await assert.rejects(google.fetchDailyMetrics("google:1234567890", "bad", "bad"), (e: GoogleAdsApiError) => e instanceof GoogleAdsApiError && /Unrecognized field: bad/.test(e.message) && !/sec|rt|dev/.test(e.message.replace(/Unrecognized/, "")));
});

test("Rate limits are retried after a pause; OAuth failures surface clearly", async () => {
  let n = 0;
  const { fetch } = fakeFetch((url) => url.includes("oauth2") ? { body: { access_token: "t", expires_in: 10 } }
    : ++n < 2 ? { status: 429, body: { error: { message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } } } : { body: { results: [{ customer: { descriptiveName: "ok" } }] } });
  const waits: number[] = [];
  const google = new GoogleAdsAdapter(cfg, fetch, async (ms) => { waits.push(ms); });
  assert.equal((await google.listAccounts())[0].name, "ok"); assert.deepEqual(waits, [30_000]);
  const bad = new GoogleAdsAdapter(cfg, fakeFetch(() => ({ status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } })).fetch);
  await assert.rejects(bad.listAccounts(), (e: GoogleAdsApiError) => e instanceof GoogleAdsApiError && /expired or revoked/.test(e.message) && !e.message.includes("sec"));
});
