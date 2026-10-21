import assert from "node:assert/strict";
import test from "node:test";
import { adOutcome, briefOutcome, evaluateOutcomes, patternOutcomeStats, snapshotFor } from "./outcomes.js";
import { PerformanceStore } from "./store.js";
import type { Suggestion } from "./suggest.js";
import type { AdScore } from "./types.js";

const score = (adId: string, over: Partial<AdScore> = {}): AdScore => ({
  adId, windowDays: 30, impressions: 50_000, spend: 500, hookRate: 0.25, ctr: 0.015, cpa: 30, score: 0, percentile: 0.5,
  isWinner: false, isLoser: false, isFatigued: false, confidence: "high", computedAt: "2026-10-21T00:00:00Z", ...over,
});
const sug = (kind: Suggestion["kind"], over: Partial<Suggestion> = {}): Suggestion => ({
  id: `${kind}_1`, kind, title: kind, body: "", rationale: "", patternIds: [], exampleAdIds: ["meta:1"], score: 1, status: "accepted", createdAt: "2026-10-01T00:00:00Z", acceptedAt: "2026-10-01T00:00:00Z", ...over,
});

test("Ad outcomes compare the cited ad with its acceptance snapshot; a paused ad counts as improved when spend stopped", () => {
  const snap = snapshotFor(score("meta:1", { hookRate: 0.2, ctr: 0.01, cpa: 40, spend: 500 }), "2026-10-01T00:00:00Z");
  assert.equal(adOutcome(sug("ad_to_scale"), snap, score("meta:1", { hookRate: 0.26, ctr: 0.012, cpa: 38 }), "now").status, "improved");
  assert.equal(adOutcome(sug("refresh_hook"), snap, score("meta:1", { hookRate: 0.15, ctr: 0.01, cpa: 40 }), "now").status, "worse");
  const flat = adOutcome(sug("ad_to_scale"), snap, score("meta:1", { hookRate: 0.205, ctr: 0.0101, cpa: 41 }), "now");
  assert.equal(flat.status, "flat"); assert.match(flat.summary, /hook 20\.0% → 20\.5% · CTR 1\.0% → 1\.0% · CPA \+2% since 2026-10-01/);
  assert.equal(adOutcome(sug("ad_to_kill"), snap, score("meta:1", { spend: 500.5 }), "now").status, "improved");
  assert.equal(adOutcome(sug("ad_to_kill"), snap, score("meta:1", { spend: 700 }), "now").status, "flat");
  assert.equal(adOutcome(sug("ad_to_scale"), snap, undefined, "now").status, "pending");
});

test("Brief outcomes look at ads from scripts that applied the pattern after acceptance", () => {
  const s = sug("hook", { patternIds: ["hook_type:loss_framed"], exampleAdIds: [] });
  const jobs = [
    { jobId: "j0", projectId: "old", createdAt: "2026-09-20T00:00:00Z", usedPatternIds: ["hook_type:loss_framed"] },
    { jobId: "j1", projectId: "p1", createdAt: "2026-10-05T00:00:00Z", usedPatternIds: ["hook_type:loss_framed"] },
    { jobId: "j2", projectId: "p2", createdAt: "2026-10-06T00:00:00Z", usedPatternIds: ["angle:fomo"] },
    { jobId: "j3", projectId: "p3", createdAt: "2026-10-07T00:00:00Z", usedPatternIds: ["hook_type:loss_framed"] },
  ];
  const byProject = new Map([["old", [score("meta:0", { isLoser: true, percentile: 0 })]], ["p1", [score("meta:1", { isWinner: true, percentile: 0.95 })]], ["p3", [score("meta:3", { percentile: 0.7 })]]]);
  const o = briefOutcome(s, "2026-10-01T00:00:00Z", jobs, byProject, "now");
  assert.equal(o.status, "won"); assert.deepEqual(o.adIds, ["meta:1", "meta:3"]); assert.match(o.summary, /2 new ads used it: 1 winner, 0 losers, mean rank 82\.5%/);
  assert.equal(briefOutcome(s, "2026-10-01T00:00:00Z", jobs, new Map(), "now").status, "pending");
  assert.equal(briefOutcome(s, "2026-10-01T00:00:00Z", [], new Map(), "now").summary, "No script has applied this pattern since it was accepted.");
});

test("evaluateOutcomes stores outcomes for accepted suggestions using the shared jobs table; stats roll up per pattern", () => {
  const store = new PerformanceStore(":memory:");
  store.db.exec("CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, status TEXT NOT NULL, owner TEXT, lease INTEGER DEFAULT 0, created TEXT NOT NULL, doc TEXT NOT NULL)");
  store.db.prepare("INSERT INTO jobs(id,status,created,doc) VALUES(?,?,?,?)").run("j1", "done", "2026-10-05", JSON.stringify({ id: "j1", projectId: "p1", createdAt: "2026-10-05T00:00:00Z", usedPatternIds: ["hook_type:loss_framed"] }));
  store.upsertAd({ id: "meta:1", accountId: "a", platform: "meta", externalId: "1", name: "p1_h1", projectId: "p1", firstSeen: "2026-10-06", lastSeen: "2026-10-20" });
  store.upsertAd({ id: "meta:2", accountId: "a", platform: "meta", externalId: "2", name: "tired", firstSeen: "2026-09-01", lastSeen: "2026-10-20" });
  store.replaceScores([score("meta:1", { isWinner: true, percentile: 1 }), score("meta:2", { hookRate: 0.3, ctr: 0.02 })]);
  store.replaceSuggestions([
    sug("hook", { id: "h1", status: "open", patternIds: ["hook_type:loss_framed"], exampleAdIds: [] }),
    sug("refresh_hook", { id: "r1", status: "open", exampleAdIds: ["meta:2"] }),
  ], { scope: "brief" });
  store.replaceSuggestions([sug("refresh_hook", { id: "r1", status: "open", exampleAdIds: ["meta:2"] })], { scope: "account" });
  store.setSuggestionStatus("h1", "accepted", { at: "2026-10-01T00:00:00Z" });
  store.setSuggestionStatus("r1", "accepted", { at: "2026-10-01T00:00:00Z", snapshot: snapshotFor(score("meta:2", { hookRate: 0.2, ctr: 0.01 }), "2026-10-01T00:00:00Z") });
  assert.equal(evaluateOutcomes(store, "2026-10-21T00:00:00Z"), 2);
  const after = store.suggestions({ status: ["accepted"] });
  assert.equal(after.find((s) => s.id === "h1")?.outcome?.status, "won");
  assert.equal(after.find((s) => s.id === "r1")?.outcome?.status, "improved");
  const stats = patternOutcomeStats(after);
  assert.deepEqual(stats.get("hook_type:loss_framed"), { won: 1, lost: 0, mixed: 0, pending: 0 });
  store.setSuggestionStatus("h1", "dismissed");
  assert.equal(store.suggestions({ status: ["dismissed"] })[0].outcome, undefined, "dismissing clears the outcome");
  store.close();
});
