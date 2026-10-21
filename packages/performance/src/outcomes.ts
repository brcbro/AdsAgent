import type { PerformanceStore } from "./store.js";
import type { Suggestion } from "./suggest.js";
import type { AdScore } from "./types.js";

/*
 * Suggestion outcome tracking. Accepting a suggestion stores a KPI snapshot; every rescore measures
 * what happened since. Account and project suggestions compare the cited ad's KPIs with the
 * snapshot; brief suggestions look for new ads whose agent job applied the cited pattern and ask
 * whether they became winners. The result feeds the KB prompt as a meta-signal.
 */

export interface KpiSnapshot { at: string; percentile?: number; hookRate?: number; ctr?: number; cpa?: number; spend?: number }
export type OutcomeStatus = "pending" | "improved" | "flat" | "worse" | "won" | "mixed" | "lost";
export interface SuggestionOutcome {
  status: OutcomeStatus;
  summary: string;
  measuredAt: string;
  /** Ads the verdict rests on (new ads for brief suggestions, the cited ad otherwise). */
  adIds: string[];
}

/** Agent jobs as the performance loop sees them: which patterns a script applied and which project it produced. */
export interface JobPatternUse { jobId: string; projectId: string; createdAt: string; usedPatternIds: string[] }

export function snapshotFor(score: AdScore | undefined, at: string): KpiSnapshot {
  return { at, percentile: score?.percentile, hookRate: score?.hookRate, ctr: score?.ctr, cpa: score?.cpa, spend: score?.spend };
}

const pct = (v?: number) => (v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
const rel = (now?: number, then?: number) => (now === undefined || then === undefined || then === 0 ? undefined : now / then - 1);

/** Compares a cited ad's current KPIs with the snapshot taken at acceptance. */
export function adOutcome(s: Suggestion, snapshot: KpiSnapshot, current: AdScore | undefined, now: string): SuggestionOutcome {
  const adId = s.exampleAdIds[0];
  if (!current) return { status: "pending", summary: "The cited ad has no fresh scores yet.", measuredAt: now, adIds: adId ? [adId] : [] };
  const hook = rel(current.hookRate, snapshot.hookRate), ctr = rel(current.ctr, snapshot.ctr), cpa = rel(current.cpa, snapshot.cpa);
  const parts = [hook !== undefined ? `hook ${pct(snapshot.hookRate)} → ${pct(current.hookRate)}` : undefined, ctr !== undefined ? `CTR ${pct(snapshot.ctr)} → ${pct(current.ctr)}` : undefined]
    .filter(Boolean).join(" · ");
  if (s.kind === "ad_to_kill") {
    const stopped = current.spend <= (snapshot.spend ?? 0) + 1;
    return { status: stopped ? "improved" : "flat", summary: stopped ? "No further spend since it was paused." : `Still spending: €${current.spend.toFixed(0)} in the window (was €${(snapshot.spend ?? 0).toFixed(0)}).`, measuredAt: now, adIds: [adId] };
  }
  // Scale / refresh / variant: better when hook or CTR rose and CPA did not rise.
  const better = ((hook ?? 0) > 0.05 || (ctr ?? 0) > 0.05) && (cpa === undefined || cpa <= 0.1);
  const worse = (hook ?? 0) < -0.1 || (ctr ?? 0) < -0.1 || (cpa ?? 0) > 0.2;
  const status: OutcomeStatus = better ? "improved" : worse ? "worse" : "flat";
  return { status, summary: `${parts || "No rate KPIs"}${cpa !== undefined ? ` · CPA ${cpa > 0 ? "+" : ""}${Math.round(cpa * 100)}%` : ""} since ${snapshot.at.slice(0, 10)}`, measuredAt: now, adIds: [adId] };
}

/** Brief suggestions: did the ads made with this pattern after acceptance win? */
export function briefOutcome(s: Suggestion, acceptedAt: string, jobs: JobPatternUse[], adsByProject: Map<string, AdScore[]>, now: string): SuggestionOutcome {
  const ids = new Set(s.patternIds);
  const projects = jobs.filter((j) => j.createdAt >= acceptedAt && j.usedPatternIds.some((p) => ids.has(p))).map((j) => j.projectId);
  const scores = [...new Set(projects)].flatMap((p) => adsByProject.get(p) ?? []).filter((x) => x.confidence !== "low");
  if (!scores.length) return { status: "pending", summary: projects.length ? `${projects.length} script${projects.length === 1 ? "" : "s"} applied the pattern; no scored ads yet.` : "No script has applied this pattern since it was accepted.", measuredAt: now, adIds: [] };
  const winners = scores.filter((x) => x.isWinner).length, losers = scores.filter((x) => x.isLoser).length;
  const meanPct = scores.reduce((a, x) => a + x.percentile, 0) / scores.length;
  const status: OutcomeStatus = winners > 0 && losers === 0 ? "won" : losers > 0 && winners === 0 ? "lost" : meanPct >= 0.6 ? "won" : meanPct <= 0.4 ? "lost" : "mixed";
  return { status, summary: `${scores.length} new ad${scores.length === 1 ? "" : "s"} used it: ${winners} winner${winners === 1 ? "" : "s"}, ${losers} loser${losers === 1 ? "" : "s"}, mean rank ${pct(meanPct)}.`, measuredAt: now, adIds: scores.map((x) => x.adId) };
}

/** Recomputes the outcome of every accepted suggestion and stores it. */
export function evaluateOutcomes(store: PerformanceStore, now = new Date().toISOString()): number {
  const scores = store.scores();
  const byId = new Map(scores.map((s) => [s.adId, s]));
  const ads = store.ads();
  const adsByProject = new Map<string, AdScore[]>();
  for (const ad of ads) {
    if (!ad.projectId) continue;
    const sc = byId.get(ad.id);
    if (sc) adsByProject.set(ad.projectId, [...(adsByProject.get(ad.projectId) ?? []), sc]);
  }
  const jobs = store.jobPatternUses();
  let n = 0;
  for (const s of store.suggestions({ status: ["accepted"] })) {
    const acceptedAt = s.acceptedAt ?? s.createdAt;
    const outcome = s.kind === "hook" || s.kind === "angle" || s.kind === "cta"
      ? briefOutcome(s, acceptedAt, jobs, adsByProject, now)
      : adOutcome(s, s.snapshot ?? snapshotFor(undefined, acceptedAt), s.exampleAdIds[0] ? byId.get(s.exampleAdIds[0]) : undefined, now);
    store.setSuggestionOutcome(s.id, outcome);
    n++;
  }
  return n;
}

/** Per-pattern meta-signal for the KB: how accepted suggestions citing it turned out. */
export function patternOutcomeStats(suggestions: Suggestion[]): Map<string, { won: number; lost: number; mixed: number; pending: number }> {
  const out = new Map<string, { won: number; lost: number; mixed: number; pending: number }>();
  for (const s of suggestions) {
    if (s.status !== "accepted" || !s.outcome) continue;
    for (const id of s.patternIds) {
      const cur = out.get(id) ?? { won: 0, lost: 0, mixed: 0, pending: 0 };
      if (s.outcome.status === "won" || s.outcome.status === "improved") cur.won++;
      else if (s.outcome.status === "lost" || s.outcome.status === "worse") cur.lost++;
      else if (s.outcome.status === "pending") cur.pending++;
      else cur.mixed++;
      out.set(id, cur);
    }
  }
  return out;
}
