import assert from "node:assert/strict";
import test from "node:test";
import { normalizationReport } from "./normalization.js";
import { computeScores } from "./score.js";
import type { AdWindowTotals, PlatformAd } from "./types.js";

const base = (over: Partial<AdWindowTotals>): AdWindowTotals => ({
  adId: "x", accountId: "acc", platform: "meta", days: 30, impressions: 30_000, spend: 400, clicks: 500, linkClicks: 400,
  videoPlays3s: 8000, videoThruplays: 2400, videoP25: 9000, videoP100: 1800, conversions: 10, conversionValue: 900, ...over,
});

test("Meta and Google are each ranked in their own group: both platforms average a 0.5 percentile even though Google's raw hook proxy is far higher", () => {
  const totals: AdWindowTotals[] = [];
  for (let i = 0; i < 6; i++) totals.push(base({ adId: `meta:${i}`, videoPlays3s: 4000 + i * 1000, linkClicks: 200 + i * 60, conversions: 4 + i * 2 }));
  for (let i = 0; i < 6; i++) totals.push(base({ adId: `google:${i}`, accountId: "g", platform: "google", videoPlays3s: undefined, videoThruplays: undefined, views: 15_000 + i * 1500, linkClicks: 200 + i * 60, conversions: 4 + i * 2 }));
  const ads: PlatformAd[] = totals.map((t) => ({ id: t.adId, accountId: t.accountId, platform: t.platform, externalId: t.adId, name: t.adId, firstSeen: "2026-10-01", lastSeen: "2026-10-30" }));
  const scores = computeScores({ totals });
  const report = normalizationReport(scores, ads);
  assert.deepEqual(report.platforms.map((p) => p.platform), ["google", "meta"]);
  const google = report.platforms[0], meta = report.platforms[1];
  assert.ok(google.meanHookRate! > meta.meanHookRate! * 1.5, "raw proxies differ");
  assert.ok(Math.abs(google.meanPercentile - 0.5) < 0.01 && Math.abs(meta.meanPercentile - 0.5) < 0.01, "percentiles are balanced");
  assert.equal(report.balanced, true);
  assert.equal(google.winners, 1); assert.equal(meta.winners, 1);
  assert.ok(scores.filter((s) => s.adId.startsWith("google:")).every((s) => s.confidence !== "high"), "Google confidence is capped at medium");
  assert.ok(scores.some((s) => s.adId.startsWith("meta:") && s.confidence === "high"));
  assert.match(google.hookRateNote, /view rate/); assert.match(report.notes.join("\n"), /capped at medium/);
});

test("An unbalanced ranking is flagged", () => {
  const ads: PlatformAd[] = [
    { id: "meta:1", accountId: "a", platform: "meta", externalId: "1", name: "m1", firstSeen: "", lastSeen: "" }, { id: "meta:2", accountId: "a", platform: "meta", externalId: "2", name: "m2", firstSeen: "", lastSeen: "" },
    { id: "google:1", accountId: "g", platform: "google", externalId: "1", name: "g1", firstSeen: "", lastSeen: "" }, { id: "google:2", accountId: "g", platform: "google", externalId: "2", name: "g2", firstSeen: "", lastSeen: "" },
  ];
  const s = (adId: string, percentile: number) => ({ adId, windowDays: 30, impressions: 1, spend: 1, score: 0, percentile, isWinner: false, isLoser: false, isFatigued: false, confidence: "high" as const, computedAt: "" });
  const report = normalizationReport([s("meta:1", 0.9), s("meta:2", 1), s("google:1", 0), s("google:2", 0.1)], ads);
  assert.equal(report.balanced, false); assert.match(report.notes.join("\n"), /google: mean percentile 0\.05/);
});
