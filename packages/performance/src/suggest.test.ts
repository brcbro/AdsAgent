import assert from "node:assert/strict";
import test from "node:test";
import type { Pattern } from "./patterns.js";
import { PerformanceStore } from "./store.js";
import { accountSuggestions, briefSuggestions, projectSuggestions, suggestionId } from "./suggest.js";
import type { Teardown } from "./teardown.js";
import type { AdScore, PlatformAd } from "./types.js";

const ad = (id: string, name: string, over: Partial<PlatformAd> = {}): PlatformAd => ({ id, accountId: "meta:1", platform: "meta", externalId: id, name, firstSeen: "2026-10-01", lastSeen: "2026-10-20", ...over });
const score = (adId: string, percentile: number, over: Partial<AdScore> = {}): AdScore => ({
  adId, windowDays: 30, impressions: 50_000, spend: 500, hookRate: 0.1 + percentile * 0.3, ctr: 0.005 + percentile * 0.02, cpa: 60 - percentile * 40, score: percentile * 2 - 1, percentile,
  isWinner: false, isLoser: false, isFatigued: false, confidence: "high", computedAt: "2026-10-21T00:00:00Z", ...over,
});

test("Account suggestions: scale high-confidence winners, refresh fatigued ones, pause losers that spent money", () => {
  const ads = [ad("meta:1", "Winner A", { projectId: "p1" }), ad("meta:2", "Tired B"), ad("meta:3", "Loser C"), ad("meta:4", "Cheap loser D"), ad("meta:5", "Mid E")];
  const scores = [
    score("meta:1", 1, { isWinner: true }), score("meta:2", 0.9, { isWinner: true, isFatigued: true }),
    score("meta:3", 0, { isLoser: true, spend: 400 }), score("meta:4", 0.1, { isLoser: true, spend: 12 }), score("meta:5", 0.5),
  ];
  const s = accountSuggestions(scores, ads, { now: "2026-10-21T00:00:00Z" });
  assert.deepEqual(s.map((x) => x.kind), ["refresh_hook", "ad_to_scale", "ad_to_kill"]);
  assert.equal(s[1].projectId, "p1"); assert.match(s[1].rationale, /hook rate 40\.0% vs .* · CTR .* · CPA €20\.00 vs/);
  assert.equal(s[2].title, 'Pause "Loser C"'); assert.ok(s.every((x) => x.exampleAdIds.length === 1));
  assert.equal(suggestionId("ad_to_scale", 'Scale "Winner A"'), s[1].id, "ids are stable across runs");
});

const pattern = (dimension: Pattern["dimension"], value: string, lift: number, n = 6): Pattern => ({
  id: `${dimension}:${value}`, dimension, value, sampleSize: n, winnerShare: 0.5, lift, direction: lift >= 1 ? "positive" : "negative",
  evidence: [{ adId: "meta:1", adName: "A", percentile: 1, hookText: value === "loss_framed" ? "Hast du den Run verpasst?" : undefined, isWinner: true }],
  summaryEn: `${dimension} "${value}" ranks ${lift}×`, summaryDe: "", updatedAt: "2026-10-21T00:00:00Z",
});

test("Brief suggestions come from positive patterns only, cite them, carry an example hook, and skip disabled ones", () => {
  const patterns = [pattern("hook_type", "loss_framed", 1.8), pattern("hook_type", "question", 1.3), pattern("hook_type", "bold_claim", 0.5), pattern("angle", "fomo", 1.5), pattern("cta_style", "direct", 1.2), pattern("hook_type", "story", 1.1)];
  const hooks = [{ adId: "meta:1", adName: "A", hookText: "Hast du den NVDA-Run verpasst?", hookType: "loss_framed", percentile: 1 }];
  const s = briefSuggestions(patterns, hooks, { disabledIds: new Set(["hook_type:question"]), now: "2026-10-21T00:00:00Z" });
  assert.deepEqual(s.map((x) => [x.kind, x.title]), [
    ["hook", "Open with a loss framed hook"], ["hook", "Open with a story hook"], ["angle", 'Lead with the "fomo" angle'], ["cta", "Close with a direct CTA"],
  ]);
  assert.match(s[0].body, /Hast du den NVDA-Run verpasst\?/); assert.deepEqual(s[0].patternIds, ["hook_type:loss_framed"]);
  assert.deepEqual(briefSuggestions([pattern("hook_type", "bold_claim", 0.5)], []), []);
});

test("Project suggestions name the best linked variant, flag pacing far from the winners, and propose a better hook type", () => {
  const ads = [ad("meta:1", "p_h1_c1", { projectId: "p", variantKey: "h1_c1_9x16" }), ad("meta:2", "p_h2_c1", { projectId: "p", variantKey: "h2_c1_9x16" }), ad("meta:3", "w1"), ad("meta:4", "w2"), ad("meta:5", "w3")];
  const scores = [score("meta:1", 0.3), score("meta:2", 0.9, { isWinner: true }), score("meta:3", 1, { isWinner: true }), score("meta:4", 0.95, { isWinner: true }), score("meta:5", 0.92, { isWinner: true })];
  const td = (adId: string, cuts: number, hookType = "bold_claim", projectId?: string): Teardown => ({
    adId, source: projectId ? "own" : "external", status: "done", projectId, visual: { visualStyle: "mixed", musicEnergy: "medium", cutsPer10s: cuts },
    structure: { hookText: "x", bodyText: "y", ctaText: "z", hookType: hookType as Teardown["structure"] extends infer S ? S extends { hookType: infer H } ? H : never : never, angle: "fomo", persona: "beginner", emotionalTrigger: "fear", claimStructure: "promise", ctaStyle: "direct", addressForm: "du", usesNumbers: false, hookNote: "" },
    createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z",
  });
  const teardowns = [td("meta:1", 1, "bold_claim", "p"), td("meta:2", 5, "loss_framed"), td("meta:3", 6), td("meta:4", 5), td("meta:5", 4)];
  const patterns = [pattern("hook_type", "loss_framed", 1.7), pattern("pacing", "fast (4+ cuts/10s)", 1.4)];
  const s = projectSuggestions("p", { ads, scores, teardowns, patterns, now: "2026-10-21T00:00:00Z" });
  assert.deepEqual(s.map((x) => x.kind), ["variant_to_render", "pacing", "hook"]);
  assert.equal(s[0].title, "Push variant h2_c1_9x16"); assert.match(s[0].body, /h1_c1_9x16 ranks lowest/);
  assert.match(s[1].title, /Cut faster/); assert.match(s[1].body, /1 cuts per 10 s; the 4 winning ads average 5\.0/); assert.deepEqual(s[1].patternIds, ["pacing:fast (4+ cuts/10s)"]);
  assert.match(s[2].title, /loss framed hook/); assert.equal(s[2].projectId, "p");
  assert.deepEqual(projectSuggestions("other", { ads, scores, teardowns, patterns }), []);
});

test("Store keeps accepted/dismissed status when suggestions are regenerated and drops ones that disappeared", () => {
  const store = new PerformanceStore(":memory:");
  const a = accountSuggestions([score("meta:1", 1, { isWinner: true })], [ad("meta:1", "A", { projectId: "linked" })]);
  store.replaceSuggestions(a, { scope: "account" });
  assert.equal(store.suggestions({ projectId: null }).length, 1, "an account action for a linked ad still lives in the account inbox");
  assert.equal(store.suggestions({ projectId: null })[0].projectId, "linked");
  store.replaceSuggestions([], { scope: "project", projectId: "linked" });
  assert.equal(store.suggestions({ projectId: null }).length, 1, "refreshing the project's own suggestions leaves it alone");
  store.setSuggestionStatus(a[0].id, "accepted");
  store.replaceSuggestions(a, { scope: "account" });
  assert.equal(store.suggestions()[0].status, "accepted");
  store.replaceSuggestions([], { scope: "account" });
  assert.equal(store.suggestions().length, 0);
  const p = projectSuggestions("p", { ads: [ad("meta:1", "x", { projectId: "p", variantKey: "h1" }), ad("meta:2", "y", { projectId: "p", variantKey: "h2" })], scores: [score("meta:1", 0.2), score("meta:2", 0.8)], teardowns: [], patterns: [] });
  store.replaceSuggestions(p, { scope: "project", projectId: "p" });
  store.replaceSuggestions(a, { scope: "account" });
  assert.equal(store.suggestions({ projectId: "p" }).length, 1, "account refresh leaves project suggestions alone");
  assert.equal(store.suggestions({ kind: "ad_to_scale" }).length, 1);
  assert.throws(() => store.setSuggestionStatus("nope", "dismissed"));
  store.close();
});

test("Regenerating suggestions keeps the acceptance time, KPI snapshot and outcome of accepted ones", () => {
  const store = new PerformanceStore(":memory:");
  const a = accountSuggestions([score("meta:1", 1, { isWinner: true })], [ad("meta:1", "A")]);
  store.replaceSuggestions(a, { scope: "account" });
  store.setSuggestionStatus(a[0].id, "accepted", { at: "2026-10-01T00:00:00Z", snapshot: { at: "2026-10-01T00:00:00Z", hookRate: 0.2 } });
  store.setSuggestionOutcome(a[0].id, { status: "improved", summary: "up", measuredAt: "2026-10-02T00:00:00Z", adIds: ["meta:1"] });
  store.replaceSuggestions(accountSuggestions([score("meta:1", 1, { isWinner: true, hookRate: 0.3 })], [ad("meta:1", "A")]), { scope: "account" });
  const kept = store.suggestions({ status: ["accepted"] })[0];
  assert.equal(kept.acceptedAt, "2026-10-01T00:00:00Z"); assert.equal(kept.snapshot?.hookRate, 0.2); assert.equal(kept.outcome?.status, "improved");
  assert.match(kept.rationale, /hook rate 30\.0%/, "the fresh rationale still comes through");
  store.close();
});
