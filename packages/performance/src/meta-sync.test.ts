import assert from "node:assert/strict";
import test from "node:test";
import type { MetaAdapter } from "./adapters/meta.js";
import { PerformanceStore } from "./store.js";
import { startNightlySync, syncAll, syncMeta } from "./sync.js";
import type { AdMetricsDaily } from "./types.js";

function fakeMeta(opts: { failAds?: boolean } = {}) {
  const calls: Array<{ account: string; from: string; to: string }> = [];
  const adapter = {
    platform: "meta",
    async listAccounts() { return [{ id: "meta:123", platform: "meta", externalId: "123", name: "Trading DE", currency: "EUR", status: "connected" }]; },
    async listAds(accountId: string, seen: string) {
      if (opts.failAds) throw new Error("Meta API: (#17) User request limit reached (code 17)");
      return [
        { id: "meta:1", accountId, platform: "meta", externalId: "1", name: "proj_a_h1_c1_9x16", firstSeen: seen, lastSeen: seen, status: "ACTIVE" },
        { id: "meta:2", accountId, platform: "meta", externalId: "2", name: "other", firstSeen: seen, lastSeen: seen, status: "ACTIVE" },
      ];
    },
    async fetchDailyMetrics(account: string, from: string, to: string) {
      calls.push({ account, from, to });
      const days: string[] = [];
      for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
      const rows: AdMetricsDaily[] = [];
      for (const date of days) {
        rows.push({ adId: "meta:1", date, impressions: 3000, spend: 45, linkClicks: 60, videoPlays3s: 1000, videoThruplays: 300, conversions: 2, conversionValue: 160 });
        rows.push({ adId: "meta:2", date, impressions: 3000, spend: 45, linkClicks: 30, videoPlays3s: 500, videoThruplays: 120, conversions: 1, conversionValue: 80 });
        // A deleted ad that only shows up in insights.
        rows.push({ adId: "meta:3", date, impressions: 2500, spend: 40, linkClicks: 10, videoPlays3s: 200, videoThruplays: 40, raw: { ad_name: "deleted creative" } });
      }
      return rows;
    },
    async fetchCreativeVideoUrl() { return null; },
  } as unknown as MetaAdapter;
  return { adapter, calls };
}

test("First Meta sync backfills 90 days, the next one re-pulls 3 days; deleted ads are kept from insights", async () => {
  const store = new PerformanceStore(":memory:");
  const { adapter, calls } = fakeMeta();
  const first = await syncMeta(store, adapter, { projectIds: ["proj_a"], today: "2026-10-21", backfillDays: 90 });
  assert.equal(first[0].status, "synced"); assert.equal(first[0].from, "2026-07-23"); assert.equal(first[0].to, "2026-10-20");
  assert.equal(store.accounts()[0].status, "connected"); assert.ok(store.accounts()[0].lastSyncAt);
  assert.equal(store.ad("meta:1")?.projectId, "proj_a"); assert.equal(store.ad("meta:1")?.variantKey, "h1_c1_9x16");
  assert.equal(store.ad("meta:3")?.name, "deleted creative"); assert.equal(store.ad("meta:3")?.status, "ARCHIVED");
  assert.equal(store.ad("meta:1")?.firstSeen, "2026-07-23"); assert.equal(store.ad("meta:1")?.lastSeen, "2026-10-21");

  const second = await syncMeta(store, adapter, { projectIds: ["proj_a"], today: "2026-10-22" });
  assert.equal(second[0].from, "2026-10-19"); assert.equal(second[0].to, "2026-10-21");
  assert.deepEqual(calls.map((c) => [c.from, c.to]), [["2026-07-23", "2026-10-20"], ["2026-10-19", "2026-10-21"]]);
  store.close();
});

test("syncAll combines inbox, Meta and scoring; an account error is reported without aborting", async () => {
  const store = new PerformanceStore(":memory:");
  const ok = await syncAll(store, { meta: fakeMeta().adapter, inboxDir: "/nonexistent-inbox-for-test-" + process.pid, projectIds: ["proj_a"], today: "2026-10-21", until: "2026-10-20" });
  assert.equal(ok.accounts[0].status, "synced"); assert.equal(ok.adsScored, 3); assert.equal(ok.winners, 1);
  assert.equal(store.scores()[0].adId, "meta:1");
  assert.deepEqual(Object.keys(store.projectSummaries()), ["proj_a"]);
  assert.equal(store.projectSummaries().proj_a.winners, 1); assert.equal(store.projectSummaries().proj_a.bestVariantKey, "h1_c1_9x16");

  const failed = await syncAll(store, { meta: fakeMeta({ failAds: true }).adapter, inboxDir: "/nonexistent-inbox-for-test-" + process.pid, projectIds: [], today: "2026-10-22", until: "2026-10-20" });
  assert.equal(failed.accounts[0].status, "error"); assert.match(failed.accounts[0].error!, /request limit/);
  assert.equal(failed.adsScored, 3, "old data is still scored");
  store.close();
});

test("Nightly scheduler runs once per local day after the hour, honours the enabled flag, and records failures", async () => {
  const store = new PerformanceStore(":memory:");
  let runs = 0;
  let clock = new Date(2026, 9, 21, 2, 30);
  const nightly = startNightlySync(store, async () => { runs++; if (runs === 2) throw new Error("boom"); }, { hour: 3, intervalMs: 60 * 60_000, now: () => clock });
  assert.equal(await nightly.check(), false, "before 03:00");
  clock = new Date(2026, 9, 21, 3, 5);
  assert.equal(await nightly.check(), true); assert.equal(runs, 1); assert.equal(store.setting("nightlyLastRun"), "2026-10-21");
  assert.equal(await nightly.check(), false, "already ran today");
  clock = new Date(2026, 9, 22, 4, 0);
  assert.equal(await nightly.check(), true); assert.equal(store.setting("nightlyLastResult"), "boom");
  store.setSetting("nightlyEnabled", "0"); clock = new Date(2026, 9, 23, 4, 0);
  assert.equal(await nightly.check(), false, "disabled"); assert.equal(runs, 2);
  nightly.stop(); store.close();
});
