import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { kbForPrompt, minePatterns, winningHooks } from "./patterns.js";
import { PerformanceStore } from "./store.js";
import { loadKbForPrompt, runTeardowns } from "./teardown-runner.js";
import { detectCutsPer10s, hashText, teardownExternal, teardownFromProject, visualFromProject, type StructureClassifier, type Teardown, type TeardownStructure } from "./teardown.js";
import type { AdScore } from "./types.js";

const structure = (over: Partial<TeardownStructure> = {}): TeardownStructure => ({
  hookText: "Hast du den NVDA-Run verpasst?", bodyText: "Dann kennst du das Gefühl.", ctaText: "Hol dir den Plan.",
  hookType: "loss_framed", angle: "fomo", persona: "beginner", emotionalTrigger: "fear", claimStructure: "promise", ctaStyle: "direct",
  addressForm: "du", usesNumbers: false, hookNote: "Loss framing.", ...over,
});
const classifier = (calls: { n: number }, over?: Partial<TeardownStructure>): StructureClassifier => async () => { calls.n++; return { structure: structure(over), model: "test-model" }; };

test("Own projects need no transcription: visual facts come from metadata and the script is the transcript", async () => {
  const v = visualFromProject({ id: "p", scriptDe: "x".repeat(280), fullAvatar: false, fastCuts: true, brollCutMs: 1000, introMs: 6000, captions: { presetId: "a" }, music: { enabled: true, volume: 0.35 } });
  assert.equal(v.visualStyle, "broll_heavy"); assert.equal(v.cutsPer10s, 10); assert.equal(v.hasTextOverlay, true); assert.equal(v.musicEnergy, "high"); assert.equal(v.durationS, 26);
  assert.equal(visualFromProject({ id: "p", scriptDe: "abc", fullAvatar: true, music: { enabled: false } }).visualStyle, "talking_head");

  const calls = { n: 0 };
  const t = await teardownFromProject("meta:1", { id: "p", title: "Proj", scriptDe: "Hast du den NVDA-Run verpasst? Dann…" }, classifier(calls));
  assert.equal(t.status, "done"); assert.equal(t.source, "own"); assert.equal(t.projectId, "p"); assert.equal(t.structure?.hookType, "loss_framed"); assert.equal(calls.n, 1);
  const again = await teardownFromProject("meta:1", { id: "p", title: "Proj", scriptDe: "Hast du den NVDA-Run verpasst? Dann…" }, classifier(calls), t);
  assert.equal(calls.n, 1, "unchanged script reuses the structure"); assert.equal(again.createdAt, t.createdAt);
  await teardownFromProject("meta:1", { id: "p", scriptDe: "Neuer Text" }, classifier(calls), t);
  assert.equal(calls.n, 2, "changed script re-runs the LLM");
  const failed = await teardownFromProject("meta:2", { id: "p", scriptDe: "x" }, async () => { throw new Error("quota"); });
  assert.equal(failed.status, "error"); assert.match(failed.error!, /quota/);
});

test("External creatives: sidecar transcript wins, ffmpeg scene detection gives cuts per 10s, missing transcript is reported", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "td-"));
  const video = path.join(dir, "ad.mp4"); fs.writeFileSync(video, "fake");
  const run = async (cmd: string) => {
    if (cmd === "ffprobe") return { stdout: JSON.stringify({ format: { duration: "30.0" } }), stderr: "" };
    return { stdout: "", stderr: Array.from({ length: 9 }, (_, i) => `[Parsed_showinfo_1] n:${i} pts_time:${i * 3}`).join("\n") };
  };
  assert.equal(await detectCutsPer10s(video, 30, run), 3);
  const calls = { n: 0 };
  const noTranscript = await teardownExternal({ adId: "meta:9", adName: "Ext", source: "external", videoPath: video }, { classify: classifier(calls), run });
  assert.equal(noTranscript.status, "needs_transcript"); assert.match(noTranscript.error!, /ad\.txt/); assert.equal(noTranscript.visual.cutsPer10s, 3); assert.equal(noTranscript.visual.durationS, 30); assert.equal(calls.n, 0);

  fs.writeFileSync(path.join(dir, "ad.txt"), "Hast du den NVDA-Run verpasst? Dann…");
  const done = await teardownExternal({ adId: "meta:9", adName: "Ext", source: "external", videoPath: video, transcriptPath: path.join(dir, "ad.txt") }, { classify: classifier(calls), run }, noTranscript);
  assert.equal(done.status, "done"); assert.equal(done.transcriptHash, hashText("Hast du den NVDA-Run verpasst? Dann…")); assert.equal(calls.n, 1);
  assert.equal(done.visual.cutsPer10s, 3, "visual facts kept from the first pass");

  const whisperCalls: string[] = [];
  const whisperRun = async (cmd: string, args: string[]) => {
    if (cmd === "ffprobe") return { stdout: JSON.stringify({ format: { duration: "10" } }), stderr: "" };
    if (cmd === "ffmpeg") return { stdout: "", stderr: "" };
    whisperCalls.push([cmd, ...args].join(" "));
    const out = args[args.indexOf("--output_dir") + 1];
    fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, "clip.txt"), "Transkript aus Whisper");
    return { stdout: "", stderr: "" };
  };
  const clip = path.join(dir, "clip.mp4"); fs.writeFileSync(clip, "fake");
  const viaWhisper = await teardownExternal({ adId: "competitor:clip", adName: "clip", source: "competitor", videoPath: clip }, { classify: classifier(calls), run: whisperRun, whisperCmd: "whisper {file} --language de --output_format txt --output_dir {dir}" });
  assert.equal(viaWhisper.status, "done"); assert.equal(viaWhisper.transcriptDe, "Transkript aus Whisper"); assert.match(whisperCalls[0], /^whisper .*clip\.mp4 --language de/);
  fs.rmSync(dir, { recursive: true, force: true });
});

const score = (adId: string, percentile: number, over: Partial<AdScore> = {}): AdScore => ({
  adId, windowDays: 30, impressions: 50_000, spend: 500, hookRate: 0.2 + percentile * 0.2, ctr: 0.01 + percentile * 0.01, score: percentile * 2 - 1, percentile,
  isWinner: percentile >= 0.85, isLoser: percentile <= 0.15, isFatigued: false, confidence: "high", computedAt: "2026-10-21T00:00:00Z", ...over,
});
const td = (adId: string, s: Partial<TeardownStructure>, visual: Partial<Teardown["visual"]> = {}): Teardown => ({
  adId, source: "own", status: "done", adName: adId, structure: structure(s), visual: { visualStyle: "mixed", musicEnergy: "medium", cutsPer10s: 3, durationS: 28, ...visual },
  createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z",
});

test("Pattern mining finds the hook type that ranks higher, ignores tiny groups, and writes quotable summaries", () => {
  const scores: AdScore[] = []; const teardowns: Teardown[] = [];
  for (let i = 0; i < 12; i++) {
    const loss = i % 2 === 0;
    const pct = loss ? 0.6 + (i / 12) * 0.4 : (i / 12) * 0.5;
    scores.push(score(`meta:${i}`, Number(pct.toFixed(2))));
    teardowns.push(td(`meta:${i}`, { hookType: loss ? "loss_framed" : "bold_claim", persona: i < 11 ? "beginner" : "advanced" }));
  }
  const patterns = minePatterns(teardowns, scores, { now: "2026-10-21T00:00:00Z" });
  const loss = patterns.find((p) => p.id === "hook_type:loss_framed")!;
  const bold = patterns.find((p) => p.id === "hook_type:bold_claim")!;
  assert.ok(loss.lift > 1.3 && loss.direction === "positive"); assert.ok(bold.lift < 0.7 && bold.direction === "negative");
  assert.equal(loss.sampleSize, 6); assert.ok(loss.hookLift! > 1); assert.equal(loss.evidence.length, 3); assert.ok(loss.evidence[0].percentile >= loss.evidence[1].percentile);
  assert.match(loss.summaryEn, /Hook type "loss_framed" ranks \d\.\d× higher than average · \d\.\d× hook rate \(n=6/);
  assert.match(loss.summaryDe, /Hook-Typ „loss_framed“ rankt \d,\d×/);
  assert.equal(patterns.find((p) => p.id === "persona:advanced"), undefined, "n=1 is ignored");
  assert.equal(patterns.find((p) => p.id === "persona:beginner"), undefined, "a value every ad shares says nothing");
  assert.equal(patterns.find((p) => p.dimension === "hook_type_x_persona" && p.value.startsWith("loss_framed"))?.sampleSize, undefined, "combo needs 8");
  assert.deepEqual(minePatterns(teardowns.slice(0, 3), scores), []);

  const hooks = winningHooks(teardowns, scores);
  assert.equal(hooks.length, 3); assert.ok(hooks.every((h) => h.hookType === "loss_framed"));
  const kb = kbForPrompt(patterns, hooks, { disabledIds: new Set(["hook_type:bold_claim"]) });
  assert.match(kb, /^<winning_patterns/); assert.match(kb, /What works:\n- \[hook_type:loss_framed\]/); assert.ok(!kb.includes("bold_claim"), "disabled pattern is left out");
  assert.match(kb, /Best-performing hooks \(German, verbatim\):\n- \(loss_framed\) "Hast du den NVDA-Run verpasst\?"/);
  assert.equal(kbForPrompt([], [], {}), "");
});

test("Runner tears down winners and losers, respects the LLM cap, picks up competitor files, and refreshes the KB", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-"));
  const competitors = path.join(dir, "competitors"); fs.mkdirSync(competitors);
  fs.writeFileSync(path.join(competitors, "rival-hook.mp4"), "x"); fs.writeFileSync(path.join(competitors, "rival-hook.txt"), "Rival transcript");
  const store = new PerformanceStore(":memory:");
  const scores: AdScore[] = [];
  for (let i = 0; i < 8; i++) {
    const id = `meta:${i}`;
    store.upsertAd({ id, accountId: "meta:1", platform: "meta", externalId: String(i), name: i < 6 ? `proj_${i}_h1` : "external ad", projectId: i < 6 ? `proj_${i}` : undefined, firstSeen: "2026-10-01", lastSeen: "2026-10-20" });
    scores.push(score(id, i / 7, { isWinner: i >= 6, isLoser: i <= 1 }));
  }
  store.replaceScores(scores);
  const calls = { n: 0 };
  const deps = {
    classify: classifier(calls, { hookType: "question" }),
    loadProject: (id: string) => ({ id, title: id, scriptDe: `Script ${id}`, fullAvatar: true }),
    run: async () => ({ stdout: JSON.stringify({ format: { duration: "20" } }), stderr: "" }),
    creativesDir: path.join(dir, "creatives"), competitorsDir: competitors,
  };
  const r1 = await runTeardowns(store, deps, { maxLlmCalls: 2, now: "2026-10-21T00:00:00Z" });
  // Candidates: winners 6,7 + losers 0,1 + 1 competitor = 5. Cap 2: two own ads done, the rest skipped or without transcript.
  assert.equal(r1.candidates, 5); assert.equal(r1.llmCalls, 2); assert.equal(r1.done, 2); assert.ok(r1.skipped >= 1);
  const r2 = await runTeardowns(store, deps, { maxLlmCalls: 10, now: "2026-10-21T00:00:00Z" });
  assert.equal(r2.skipped, 0); assert.equal(store.teardown("competitor:rival-hook")?.status, "done"); assert.equal(store.teardown("competitor:rival-hook")?.source, "competitor");
  assert.equal(store.teardown("meta:7")?.status, "needs_transcript", "external winner without a creative file");
  assert.equal(store.teardown("meta:0")?.source, "own");
  const r3 = await runTeardowns(store, deps, { maxLlmCalls: 10 });
  assert.equal(r3.llmCalls, 0, "nothing changed, nothing re-classified");
  const one = await runTeardowns(store, deps, { adIds: ["meta:3"] });
  assert.equal(one.candidates, 1); assert.equal(store.teardown("meta:3")?.status, "done");
  assert.ok(Array.isArray(store.patterns()));
  store.setPatternDisabled("hook_type:question", true);
  assert.ok(store.disabledPatternIds().has("hook_type:question"));
  assert.equal(typeof loadKbForPrompt(store), "string");
  store.close(); fs.rmSync(dir, { recursive: true, force: true });
});
