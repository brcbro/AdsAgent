import assert from "node:assert/strict";
import test from "node:test";
import { computeScores, confidenceFor, kpis, shrink } from "./score.js";
import type { AdWindowTotals } from "./types.js";

const base = (over: Partial<AdWindowTotals>): AdWindowTotals => ({
  adId: "meta:1", accountId: "acc", platform: "meta", days: 30,
  impressions: 20_000, spend: 300, clicks: 400, linkClicks: 300,
  videoPlays3s: 5000, videoThruplays: 1500, videoP25: 6000, videoP100: 1200, conversions: 10, conversionValue: 900,
  ...over,
});

test("Meta KPIs use 3-second plays and ThruPlays; Google uses views and quartiles", () => {
  const m = kpis(base({}));
  assert.equal(m.hookRate, 0.25); assert.equal(m.holdRate, 0.3); assert.equal(m.ctr, 0.015);
  assert.equal(m.cpa, 30); assert.equal(m.roas, 3);
  const g = kpis(base({ platform: "google", videoPlays3s: undefined, videoThruplays: undefined, views: 8000 }));
  assert.equal(g.hookRate, 0.4); assert.equal(g.holdRate, 0.2);
});

test("Missing denominators produce undefined, never NaN or Infinity", () => {
  const k = kpis(base({ impressions: 0, videoPlays3s: 0, conversions: 0, spend: 0 }));
  assert.equal(k.hookRate, undefined); assert.equal(k.ctr, undefined); assert.equal(k.cpa, undefined); assert.equal(k.roas, undefined);
});

test("Confidence follows impression and spend thresholds", () => {
  assert.equal(confidenceFor({ impressions: 500, spend: 50 }), "low");
  assert.equal(confidenceFor({ impressions: 5000, spend: 50 }), "medium");
  assert.equal(confidenceFor({ impressions: 50_000, spend: 500 }), "high");
});

test("Shrinkage pulls a tiny sample toward the mean and leaves a large one alone", () => {
  assert.ok(Math.abs(shrink(0.9, 10, 0.2, 1000)! - 0.2) < 0.01);
  assert.ok(Math.abs(shrink(0.9, 1_000_000, 0.2, 1000)! - 0.9) < 0.001);
});

test("A 1,200-impression fluke never becomes the winner; the strong high-volume ad does", () => {
  const totals = [
    base({ adId: "meta:fluke", impressions: 1200, spend: 25, videoPlays3s: 900, videoThruplays: 800, linkClicks: 100, conversions: 5, conversionValue: 500 }),
    base({ adId: "meta:strong", impressions: 50_000, spend: 800, videoPlays3s: 20_000, videoThruplays: 8000, linkClicks: 1200, conversions: 60, conversionValue: 7000 }),
    base({ adId: "meta:mid", impressions: 40_000, spend: 700, videoPlays3s: 9000, videoThruplays: 2500, linkClicks: 500, conversions: 25, conversionValue: 2000 }),
    base({ adId: "meta:weak", impressions: 45_000, spend: 900, videoPlays3s: 6000, videoThruplays: 1200, linkClicks: 300, conversions: 8, conversionValue: 600 }),
    base({ adId: "meta:tiny", impressions: 200, spend: 3, videoPlays3s: 190, videoThruplays: 180, linkClicks: 50, conversions: 4, conversionValue: 400 }),
  ];
  const scores = computeScores({ totals, now: "2026-10-20T00:00:00Z" });
  const byId = Object.fromEntries(scores.map((s) => [s.adId, s]));
  assert.equal(byId["meta:strong"].isWinner, true);
  assert.equal(byId["meta:fluke"].isWinner, false);
  assert.equal(byId["meta:tiny"].confidence, "low");
  assert.equal(byId["meta:tiny"].isWinner, false); assert.equal(byId["meta:tiny"].isLoser, false);
  assert.equal(byId["meta:weak"].isLoser, true);
  assert.equal(scores[0].adId, "meta:strong");
  for (const s of scores) assert.ok(Number.isFinite(s.score) && s.percentile >= 0 && s.percentile <= 1);
});

test("Platforms are scored in separate groups, so Google's view rate never competes with Meta's hook rate", () => {
  const totals = [
    base({ adId: "meta:a" }), base({ adId: "meta:b", videoPlays3s: 2000 }),
    base({ adId: "google:a", platform: "google", accountId: "g", videoPlays3s: undefined, videoThruplays: undefined, views: 15_000 }),
    base({ adId: "google:b", platform: "google", accountId: "g", videoPlays3s: undefined, videoThruplays: undefined, views: 3000 }),
  ];
  const scores = computeScores({ totals });
  const top = (p: string) => scores.filter((s) => s.adId.startsWith(p)).sort((a, b) => b.score - a.score)[0].adId;
  assert.equal(top("meta"), "meta:a"); assert.equal(top("google"), "google:a");
});

test("Without any conversion data the CPA and ROAS weights are redistributed and scoring still works", () => {
  const totals = [
    base({ adId: "meta:a", conversions: undefined, conversionValue: undefined }),
    base({ adId: "meta:b", conversions: undefined, conversionValue: undefined, videoPlays3s: 1000 }),
  ];
  const scores = computeScores({ totals });
  assert.equal(scores.length, 2);
  assert.ok(scores.every((s) => Number.isFinite(s.score)));
  assert.ok(scores.find((s) => s.adId === "meta:a")!.score > scores.find((s) => s.adId === "meta:b")!.score);
});

test("A winner whose 7-day hook rate fell more than 30% is flagged fatigued", () => {
  const totals = [
    base({ adId: "meta:win", videoPlays3s: 8000, linkClicks: 900, conversions: 50, conversionValue: 5000 }),
    base({ adId: "meta:b" }), base({ adId: "meta:c", videoPlays3s: 3000 }),
  ];
  const recent = [base({ adId: "meta:win", days: 7, impressions: 5000, spend: 80, videoPlays3s: 1000, linkClicks: 200 })];
  const scores = computeScores({ totals, recent });
  const win = scores.find((s) => s.adId === "meta:win")!;
  assert.equal(win.isWinner, true); assert.equal(win.isFatigued, true);
  assert.equal(scores.find((s) => s.adId === "meta:b")!.isFatigued, false);
});
