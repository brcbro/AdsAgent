import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@ai-ads/core";
import { kbForPrompt, minePatterns, winningHooks, type Pattern } from "./patterns.js";
import { evaluateOutcomes, patternOutcomeStats } from "./outcomes.js";
import { accountSuggestions, briefSuggestions, projectSuggestions, type Suggestion } from "./suggest.js";
import type { PerformanceStore } from "./store.js";
import {
  teardownExternal, teardownFromProject, type CommandRunner, type ProjectMetadataLike, type StructureClassifier, type Teardown,
} from "./teardown.js";

export const CREATIVES_DIR = path.join(REPO_ROOT, "data", "performance", "creatives");
export const COMPETITORS_DIR = path.join(REPO_ROOT, "data", "performance", "competitors");
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;

export interface TeardownDeps {
  classify: StructureClassifier;
  loadProject: (projectId: string) => ProjectMetadataLike | null;
  run?: CommandRunner;
  ffmpegBin?: string;
  ffprobeBin?: string;
  whisperCmd?: string;
  creativesDir?: string;
  competitorsDir?: string;
}
export interface TeardownRunOptions {
  /** Cap on LLM structure calls in one run; unchanged transcripts cost nothing. */
  maxLlmCalls?: number;
  /** Only these ads (manual "Tear down" button); otherwise winners, losers and competitors. */
  adIds?: string[];
  now?: string;
}
export interface TeardownReport {
  candidates: number; done: number; needsTranscript: number; errors: number; skipped: number; llmCalls: number;
  patterns: number; items: Array<{ adId: string; status: Teardown["status"]; error?: string }>;
}

/** Competitor creatives dropped as files: `data/performance/competitors/<name>.mp4` (+ optional `<name>.txt`). */
export function competitorInputs(dir = COMPETITORS_DIR): Array<{ adId: string; adName: string; videoPath: string; transcriptPath?: string }> {
  try {
    return fs.readdirSync(dir).filter((f) => VIDEO_EXT.test(f)).sort().map((f) => {
      const stem = f.replace(VIDEO_EXT, "");
      const txt = path.join(dir, `${stem}.txt`);
      return { adId: `competitor:${stem}`, adName: stem.replace(/[-_]+/g, " "), videoPath: path.join(dir, f), transcriptPath: fs.existsSync(txt) ? txt : undefined };
    });
  } catch { return []; }
}

export async function runTeardowns(store: PerformanceStore, deps: TeardownDeps, opts: TeardownRunOptions = {}): Promise<TeardownReport> {
  const report: TeardownReport = { candidates: 0, done: 0, needsTranscript: 0, errors: 0, skipped: 0, llmCalls: 0, patterns: 0, items: [] };
  const maxLlm = opts.maxLlmCalls ?? 10;
  const ads = new Map(store.ads().map((a) => [a.id, a]));
  const scores = store.scores();
  const wanted = new Set(opts.adIds ?? scores.filter((s) => s.isWinner || s.isLoser).map((s) => s.adId));
  const creativesDir = deps.creativesDir ?? CREATIVES_DIR;
  // Counts an LLM call only when the structure must be (re)computed.
  const needsLlm = (existing: Teardown | undefined, transcript: string | undefined) => !existing?.structure || (transcript !== undefined && existing.transcriptHash !== hashOf(transcript));
  const classify: StructureClassifier = async (input) => { report.llmCalls++; return deps.classify(input); };

  for (const adId of wanted) {
    const ad = ads.get(adId);
    if (!ad) continue;
    report.candidates++;
    const existing = store.teardown(adId);
    const project = ad.projectId ? deps.loadProject(ad.projectId) : null;
    if (project && needsLlm(existing, project.scriptDe.trim()) && report.llmCalls >= maxLlm) { report.skipped++; continue; }
    let t: Teardown;
    if (project) t = await teardownFromProject(adId, project, classify, existing);
    else {
      const stem = adId.replace(/[^a-z0-9_-]/gi, "_");
      const videoPath = [".mp4", ".mov", ".webm"].map((e) => path.join(creativesDir, stem + e)).find((p) => fs.existsSync(p));
      const transcriptPath = path.join(creativesDir, `${stem}.txt`);
      const willCall = needsLlm(existing, fs.existsSync(transcriptPath) ? fs.readFileSync(transcriptPath, "utf8").trim() : existing?.transcriptDe);
      if (willCall && report.llmCalls >= maxLlm) { report.skipped++; continue; }
      t = await teardownExternal({ adId, adName: ad.name, source: "external", videoPath, transcriptPath, projectId: ad.projectId }, { ...deps, classify }, existing);
    }
    store.upsertTeardown(t);
    report.items.push({ adId, status: t.status, error: t.error });
    if (t.status === "done") report.done++; else if (t.status === "needs_transcript") report.needsTranscript++; else report.errors++;
  }

  if (!opts.adIds) {
    for (const c of competitorInputs(deps.competitorsDir)) {
      report.candidates++;
      const existing = store.teardown(c.adId);
      const transcript = c.transcriptPath ? fs.readFileSync(c.transcriptPath, "utf8").trim() : existing?.transcriptDe;
      if (needsLlm(existing, transcript) && report.llmCalls >= maxLlm) { report.skipped++; continue; }
      const t = await teardownExternal({ ...c, source: "competitor" }, { ...deps, classify }, existing);
      store.upsertTeardown(t);
      report.items.push({ adId: c.adId, status: t.status, error: t.error });
      if (t.status === "done") report.done++; else if (t.status === "needs_transcript") report.needsTranscript++; else report.errors++;
    }
  }

  report.patterns = refreshPatterns(store, opts.now).length;
  return report;
}

function hashOf(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

export function refreshPatterns(store: PerformanceStore, now?: string): Pattern[] {
  const patterns = minePatterns(store.teardowns(), store.scores(), { now });
  store.replacePatterns(patterns);
  store.setSetting("patternsUpdatedAt", now ?? new Date().toISOString());
  refreshSuggestions(store, now);
  return patterns;
}

/** What the script prompts receive. Empty string when nothing has been learned yet. */
export function loadKbForPrompt(store: PerformanceStore): string {
  return kbForPrompt(store.patterns(), winningHooks(store.teardowns(), store.scores()), {
    disabledIds: store.disabledPatternIds(), outcomes: patternOutcomeStats(store.suggestions({ status: ["accepted"] })),
  });
}

/** Account and brief suggestions are regenerated after every rescore / KB refresh. */
export function refreshSuggestions(store: PerformanceStore, now?: string): { account: number; brief: number } {
  const account = accountSuggestions(store.scores(), store.ads(), { now });
  const brief = briefSuggestions(store.patterns(), winningHooks(store.teardowns(), store.scores(), 5), { disabledIds: store.disabledPatternIds(), now });
  store.replaceSuggestions(account, { scope: "account" });
  store.replaceSuggestions(brief, { scope: "brief" });
  evaluateOutcomes(store, now);
  return { account: account.length, brief: brief.length };
}

/** Project suggestions are computed on demand (final review) and persisted so accept/dismiss sticks. */
export function projectSuggestionsFor(store: PerformanceStore, projectId: string, now?: string): Suggestion[] {
  const list = projectSuggestions(projectId, { ads: store.ads(), scores: store.scores(), teardowns: store.teardowns(), patterns: store.patterns(), now });
  store.replaceSuggestions(list, { scope: "project", projectId });
  return store.suggestions({ projectId });
}
