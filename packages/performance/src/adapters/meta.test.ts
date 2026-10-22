import assert from "node:assert/strict";
import test from "node:test";
import { MetaAdapter, MetaApiError, actId, dateChunks, mapInsightRow, metaConfigFromEnv, type MetaConfig } from "./meta.js";

const cfg: MetaConfig = { accessToken: "tok", accountIds: ["123", "act_456"], apiVersion: "v21.0", conversionActions: ["purchase", "omni_purchase"], leadActions: ["lead"] };

test("Env config requires a token and at least one account; ids accept both forms", () => {
  assert.equal(metaConfigFromEnv({}), undefined);
  assert.equal(metaConfigFromEnv({ META_ACCESS_TOKEN: "t" }), undefined);
  const c = metaConfigFromEnv({ META_ACCESS_TOKEN: "t", META_AD_ACCOUNT_IDS: "123, act_456", META_CONVERSION_ACTIONS: "lead" })!;
  assert.deepEqual(c.accountIds, ["123", "act_456"]); assert.deepEqual(c.conversionActions, ["lead"]); assert.equal(c.apiVersion, "v21.0");
  assert.equal(actId("123"), "act_123"); assert.equal(actId("act_123"), "act_123");
});

test("Insight rows map video actions, link clicks and the preferred conversion action", () => {
  const m = mapInsightRow({
    ad_id: "9", ad_name: "x", date_start: "2026-10-01", impressions: "12345", reach: "9000", spend: "150.25", clicks: "300", inline_link_clicks: "240",
    video_play_actions: [{ action_type: "video_view", value: "3100" }], video_thruplay_watched_actions: [{ action_type: "video_view", value: "900" }],
    video_p25_watched_actions: [{ action_type: "video_view", value: "3500" }], video_p100_watched_actions: [{ action_type: "video_view", value: "700" }],
    actions: [{ action_type: "link_click", value: "240" }, { action_type: "video_view", value: "3100" }, { action_type: "omni_purchase", value: "6" }, { action_type: "purchase", value: "4" }, { action_type: "lead", value: "2" }],
    action_values: [{ action_type: "purchase", value: "380.5" }],
  }, cfg);
  assert.equal(m.adId, "meta:9"); assert.equal(m.date, "2026-10-01"); assert.equal(m.impressions, 12_345); assert.equal(m.spend, 150.25);
  assert.equal(m.linkClicks, 240); assert.equal(m.videoThruplays, 900); assert.equal(m.videoP25, 3500); assert.equal(m.videoP100, 700);
  // Hook rate must use 3-second plays (the video_view action), not every autoplay start.
  const starts = mapInsightRow({ ad_id: "9", date_start: "2026-10-01", impressions: "10000", video_play_actions: [{ action_type: "video_view", value: "9400" }], actions: [{ action_type: "video_view", value: "2600" }] }, cfg);
  assert.equal(starts.videoPlays3s, 2600); assert.equal(starts.videoPlaysAny, 9400);
  assert.equal(mapInsightRow({ ad_id: "9", date_start: "2026-10-01", video_play_actions: [{ action_type: "video_view", value: "50" }] }, cfg).videoPlays3s, 50, "falls back to starts when the action is absent");
  assert.equal(m.conversions, 4); assert.equal(m.conversionValue, 380.5); assert.equal(m.leads, 2);
  const empty = mapInsightRow({ ad_id: "1", date_start: "2026-10-02" }, cfg);
  assert.equal(empty.impressions, undefined); assert.equal(empty.videoPlays3s, undefined); assert.equal(empty.conversions, undefined);
});

test("Date ranges are chunked into 30-day windows that cover every day exactly once", () => {
  const chunks = dateChunks("2026-07-01", "2026-09-28");
  assert.deepEqual(chunks, [
    { since: "2026-07-01", until: "2026-07-30" }, { since: "2026-07-31", until: "2026-08-29" }, { since: "2026-08-30", until: "2026-09-28" },
  ]);
  assert.deepEqual(dateChunks("2026-10-19", "2026-10-21"), [{ since: "2026-10-19", until: "2026-10-21" }]);
});

function fakeFetch(handler: (url: URL) => { status?: number; body: unknown }) {
  const calls: URL[] = [];
  const f = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    calls.push(url);
    const { status = 200, body } = handler(url);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetch: f, calls };
}

test("Adapter lists accounts and ads, follows paging, and never leaks the token into errors", async () => {
  const { fetch, calls } = fakeFetch((url) => {
    assert.equal(url.searchParams.get("access_token"), "tok");
    if (url.pathname.endsWith("/act_123") ) return { body: { id: "act_123", name: "Trading DE", currency: "EUR", timezone_name: "Europe/Berlin" } };
    if (url.pathname.endsWith("/act_456")) return { body: { id: "act_456", name: "Second" } };
    if (url.pathname.endsWith("/act_123/ads") && !url.searchParams.get("after")) {
      return { body: { data: [{ id: "1", name: "proj_h1_c1", campaign: { name: "C" }, adset: { name: "S" }, creative: { video_id: "v1", thumbnail_url: "t" }, effective_status: "ACTIVE" }], paging: { next: `https://graph.facebook.com/v21.0/act_123/ads?after=abc&fields=x` } } };
    }
    if (url.pathname.endsWith("/act_123/ads")) return { body: { data: [{ id: "2", name: "second ad" }] } };
    if (url.pathname.endsWith("/act_123/insights")) {
      return { body: { data: [{ ad_id: "1", date_start: "2026-10-01", impressions: "10", spend: "1.5", video_play_actions: [{ action_type: "video_view", value: "4" }] }] } };
    }
    return { status: 400, body: { error: { message: "Unsupported get request", code: 100 } } };
  });
  const meta = new MetaAdapter(cfg, fetch);
  const accounts = await meta.listAccounts();
  assert.deepEqual(accounts.map((a) => [a.id, a.name, a.currency, a.status]), [["meta:123", "Trading DE", "EUR", "connected"], ["meta:456", "Second", undefined, "connected"]]);
  const ads = await meta.listAds("meta:123", "2026-10-21");
  assert.equal(ads.length, 2); assert.equal(ads[0].id, "meta:1"); assert.equal(ads[0].accountId, "meta:123"); assert.equal(ads[0].campaignName, "C");
  assert.equal(ads[0].creativeVideoUrl, "meta-video:v1"); assert.equal(ads[0].status, "ACTIVE"); assert.equal(ads[1].name, "second ad");
  assert.ok(calls.some((u) => u.searchParams.get("after") === "abc"), "followed paging.next");
  const metrics = await meta.fetchDailyMetrics("meta:123", "2026-10-01", "2026-10-03");
  assert.equal(metrics.length, 1); assert.equal(metrics[0].videoPlays3s, 4);
  const insightCall = calls.find((u) => u.pathname.endsWith("/insights"))!;
  assert.equal(insightCall.searchParams.get("level"), "ad"); assert.equal(insightCall.searchParams.get("time_increment"), "1");
  assert.deepEqual(JSON.parse(insightCall.searchParams.get("time_range")!), { since: "2026-10-01", until: "2026-10-03" });
  await assert.rejects(meta.fetchCreativeVideoUrl("meta:zzz"), (e: MetaApiError) => e instanceof MetaApiError && e.code === 100 && !e.message.includes("tok"));
});

test("Rate-limit errors are retried after a pause, other errors are not", async () => {
  let n = 0;
  const { fetch } = fakeFetch(() => (++n < 3 ? { status: 400, body: { error: { message: "User request limit reached", code: 17 } } } : { body: { id: "act_123", name: "ok" } }));
  const waits: number[] = [];
  const meta = new MetaAdapter({ ...cfg, accountIds: ["123"] }, fetch, async (ms) => { waits.push(ms); });
  const accounts = await meta.listAccounts();
  assert.equal(accounts[0].name, "ok"); assert.deepEqual(waits, [30_000, 60_000]);
});
