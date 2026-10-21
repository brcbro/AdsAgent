import type { Pattern } from "./patterns.js";
import type { winningHooks } from "./patterns.js";
import type { Teardown } from "./teardown.js";
import type { AdScore, PlatformAd } from "./types.js";

/*
 * Suggestions: ranked, explained recommendations that always cite a pattern or a real ad.
 * Three producers: account actions after a sync, brief suggestions from the KB when a chat opens,
 * and project suggestions at final review. Deterministic and free; the LLM only writes scripts.
 */

export type SuggestionKind = "ad_to_scale" | "ad_to_kill" | "refresh_hook" | "hook" | "angle" | "cta" | "variant_to_render" | "pacing";
export type SuggestionStatus = "open" | "accepted" | "dismissed";

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  projectId?: string;
  sessionId?: string;
  title: string;
  body: string;
  rationale: string;
  patternIds: string[];
  exampleAdIds: string[];
  /** Higher sorts first within a kind. */
  score: number;
  status: SuggestionStatus;
  createdAt: string;
  /** Set on accept: when, and the cited ad's KPIs at that moment. */
  acceptedAt?: string;
  snapshot?: { at: string; percentile?: number; hookRate?: number; ctr?: number; cpa?: number; spend?: number };
  /** What happened after acceptance; recomputed on every rescore. */
  outcome?: { status: "pending" | "improved" | "flat" | "worse" | "won" | "mixed" | "lost"; summary: string; measuredAt: string; adIds: string[] };
}

export function suggestionId(kind: SuggestionKind, title: string, projectId?: string): string {
  let h = 2166136261;
  for (const ch of `${projectId ?? ""}|${kind}|${title}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `${kind}_${(h >>> 0).toString(16)}`;
}

const pct = (v: number | undefined) => (v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
const eur = (v: number | undefined, d = 0) => (v === undefined ? "—" : `€${v.toFixed(d)}`);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/** Scale / kill / refresh actions from the current scores. Numbers are compared with the account mean. */
export function accountSuggestions(scores: AdScore[], ads: PlatformAd[], opts: { minKillSpend?: number; now?: string } = {}): Suggestion[] {
  const now = opts.now ?? new Date().toISOString();
  const adById = new Map(ads.map((a) => [a.id, a]));
  const byAccount = new Map<string, AdScore[]>();
  for (const s of scores) {
    const acc = adById.get(s.adId)?.accountId ?? "?";
    byAccount.set(acc, [...(byAccount.get(acc) ?? []), s]);
  }
  const out: Suggestion[] = [];
  for (const group of byAccount.values()) {
    const hookMean = mean(group.filter((s) => s.hookRate !== undefined).map((s) => s.hookRate!));
    const ctrMean = mean(group.filter((s) => s.ctr !== undefined).map((s) => s.ctr!));
    const cpaMean = mean(group.filter((s) => s.cpa !== undefined).map((s) => s.cpa!));
    const vs = (s: AdScore) => [
      s.hookRate !== undefined && hookMean !== undefined ? `hook rate ${pct(s.hookRate)} vs ${pct(hookMean)}` : undefined,
      s.ctr !== undefined && ctrMean !== undefined ? `CTR ${pct(s.ctr)} vs ${pct(ctrMean)}` : undefined,
      s.cpa !== undefined && cpaMean !== undefined ? `CPA ${eur(s.cpa, 2)} vs ${eur(cpaMean, 2)}` : undefined,
    ].filter(Boolean).join(" · ");
    for (const s of group) {
      const ad = adById.get(s.adId);
      const name = ad?.name ?? s.adId;
      if (s.isWinner && s.isFatigued) {
        const title = `Refresh the hook of "${name}"`;
        out.push({ id: suggestionId("refresh_hook", title), kind: "refresh_hook", projectId: ad?.projectId, title,
          body: `Still a winner over 30 days, but its 7-day hook rate or CTR dropped more than 30%. Swap the hook segment and keep body and CTA.`,
          rationale: `${vs(s)} · ${eur(s.spend)} spend`, patternIds: [], exampleAdIds: [s.adId], score: 0.9 + s.percentile, status: "open", createdAt: now });
      } else if (s.isWinner && s.confidence === "high") {
        const title = `Scale "${name}"`;
        out.push({ id: suggestionId("ad_to_scale", title), kind: "ad_to_scale", projectId: ad?.projectId, title,
          body: `Top of its account on the composite score with high confidence. Raise budget or duplicate into a new ad set.`,
          rationale: `${vs(s)} · ${eur(s.spend)} spend`, patternIds: [], exampleAdIds: [s.adId], score: s.percentile, status: "open", createdAt: now });
      } else if (s.isLoser && s.spend >= (opts.minKillSpend ?? 50)) {
        const title = `Pause "${name}"`;
        out.push({ id: suggestionId("ad_to_kill", title), kind: "ad_to_kill", projectId: ad?.projectId, title,
          body: `Bottom of its account over 30 days with ${eur(s.spend)} already spent. Pause it and reuse the budget on a winner.`,
          rationale: vs(s), patternIds: [], exampleAdIds: [s.adId], score: 1 - s.percentile, status: "open", createdAt: now });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

type Hooks = ReturnType<typeof winningHooks>;

/** What to try in the next brief, from the KB. One suggestion per strong hook type, plus the best angle and CTA style. */
export function briefSuggestions(patterns: Pattern[], hooks: Hooks, opts: { disabledIds?: Set<string>; now?: string } = {}): Suggestion[] {
  const now = opts.now ?? new Date().toISOString();
  const disabled = opts.disabledIds ?? new Set<string>();
  const live = patterns.filter((p) => !disabled.has(p.id) && p.direction === "positive");
  const out: Suggestion[] = [];
  const hookPatterns = live.filter((p) => p.dimension === "hook_type").slice(0, 3);
  for (const p of hookPatterns) {
    const example = hooks.find((h) => h.hookType === p.value) ?? p.evidence.find((e) => e.hookText);
    const exampleText = example && "hookText" in example ? example.hookText : undefined;
    const title = `Open with a ${p.value.replace(/_/g, " ")} hook`;
    out.push({ id: suggestionId("hook", title), kind: "hook", title,
      body: exampleText ? `Like „${exampleText}“ — same mechanism, new angle or ticker.` : `Write the first sentence as a ${p.value.replace(/_/g, " ")} hook.`,
      rationale: p.summaryEn, patternIds: [p.id], exampleAdIds: p.evidence.map((e) => e.adId), score: p.lift * Math.sqrt(p.sampleSize), status: "open", createdAt: now });
  }
  const angle = live.find((p) => p.dimension === "angle");
  if (angle) {
    const title = `Lead with the "${angle.value.replace(/_/g, " ")}" angle`;
    out.push({ id: suggestionId("angle", title), kind: "angle", title, body: `Frame the whole ad around ${angle.value.replace(/_/g, " ")}; it ranks ${angle.lift}× above average.`,
      rationale: angle.summaryEn, patternIds: [angle.id], exampleAdIds: angle.evidence.map((e) => e.adId), score: angle.lift * Math.sqrt(angle.sampleSize), status: "open", createdAt: now });
  }
  const cta = live.find((p) => p.dimension === "cta_style");
  if (cta) {
    const title = `Close with a ${cta.value.replace(/_/g, " ")} CTA`;
    out.push({ id: suggestionId("cta", title), kind: "cta", title, body: `Phrase the call to action as "${cta.value.replace(/_/g, " ")}".`,
      rationale: cta.summaryEn, patternIds: [cta.id], exampleAdIds: cta.evidence.map((e) => e.adId), score: cta.lift * Math.sqrt(cta.sampleSize), status: "open", createdAt: now });
  }
  return out;
}

/** Final-review advice for one project: which linked variant to push, and whether the pacing matches the winners. */
export function projectSuggestions(projectId: string, input: { ads: PlatformAd[]; scores: AdScore[]; teardowns: Teardown[]; patterns: Pattern[]; now?: string }): Suggestion[] {
  const now = input.now ?? new Date().toISOString();
  const scoreById = new Map(input.scores.map((s) => [s.adId, s]));
  const linked = input.ads.filter((a) => a.projectId === projectId && scoreById.has(a.id)).map((a) => ({ a, s: scoreById.get(a.id)! })).sort((x, y) => y.s.score - x.s.score);
  const out: Suggestion[] = [];
  if (linked.length >= 2 && linked[0].a.variantKey) {
    const best = linked[0], worst = linked[linked.length - 1];
    const title = `Push variant ${best.a.variantKey}`;
    out.push({ id: suggestionId("variant_to_render", title, projectId), kind: "variant_to_render", projectId, title,
      body: `Of ${linked.length} linked variants, ${best.a.variantKey} ranks highest (hook ${pct(best.s.hookRate)}, CTR ${pct(best.s.ctr)})${worst.a.variantKey ? `; ${worst.a.variantKey} ranks lowest (hook ${pct(worst.s.hookRate)})` : ""}. Render new CTAs on top of this hook first.`,
      rationale: `Percentile ${pct(best.s.percentile)} vs ${pct(worst.s.percentile)} in the account`, patternIds: [], exampleAdIds: [best.a.id, worst.a.id], score: best.s.percentile, status: "open", createdAt: now });
  }
  const winnersCuts = input.teardowns.filter((t) => t.status === "done" && scoreById.get(t.adId)?.isWinner && t.visual.cutsPer10s !== undefined).map((t) => t.visual.cutsPer10s!);
  const own = input.teardowns.find((t) => t.projectId === projectId && t.status === "done");
  const winnerMean = mean(winnersCuts);
  if (own?.visual.cutsPer10s !== undefined && winnerMean !== undefined && winnersCuts.length >= 3) {
    const mine = own.visual.cutsPer10s;
    if (mine < winnerMean * 0.6 || mine > winnerMean * 1.6) {
      const faster = mine < winnerMean;
      const title = faster ? "Cut faster: winners average more B-roll cuts" : "Cut slower: winners hold shots longer";
      const pacing = input.patterns.find((p) => p.dimension === "pacing" && p.direction === "positive");
      out.push({ id: suggestionId("pacing", title, projectId), kind: "pacing", projectId, title,
        body: `This project has ${mine} cuts per 10 s; the ${winnersCuts.length} winning ads average ${winnerMean.toFixed(1)}. ${faster ? "Lower the B-roll clip length or enable fast cuts." : "Raise the B-roll clip length or turn fast cuts off."}`,
        rationale: pacing?.summaryEn ?? `Winners' mean pacing ${winnerMean.toFixed(1)} cuts/10 s`, patternIds: pacing ? [pacing.id] : [], exampleAdIds: [], score: Math.abs(mine - winnerMean) / winnerMean, status: "open", createdAt: now });
    }
  }
  const hookPattern = input.patterns.find((p) => p.dimension === "hook_type" && p.direction === "positive");
  if (own?.structure && hookPattern && own.structure.hookType !== hookPattern.value && !input.patterns.some((p) => p.id === `hook_type:${own.structure!.hookType}` && p.direction === "positive")) {
    const title = `Try a ${hookPattern.value.replace(/_/g, " ")} hook for the next variant`;
    out.push({ id: suggestionId("hook", title, projectId), kind: "hook", projectId, title,
      body: `This script opens with a "${own.structure.hookType.replace(/_/g, " ")}" hook; "${hookPattern.value.replace(/_/g, " ")}" hooks rank ${hookPattern.lift}× above average in your account.`,
      rationale: hookPattern.summaryEn, patternIds: [hookPattern.id], exampleAdIds: hookPattern.evidence.map((e) => e.adId), score: hookPattern.lift, status: "open", createdAt: now });
  }
  return out;
}
