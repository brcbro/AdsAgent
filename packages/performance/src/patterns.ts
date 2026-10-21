import type { Teardown } from "./teardown.js";
import type { AdScore } from "./types.js";

/*
 * Winning Patterns KB. For every (dimension, value) with enough torn-down, scored ads we compare
 * the ads that have the value against the whole scored set. Composite scores are z-scores
 * (mean 0), so "lift" is computed on percentile rank; hook-rate and CTR lifts are real ratios the
 * creative team can quote ("2.1× hook rate").
 */

export type PatternDimension = "hook_type" | "angle" | "persona" | "emotional_trigger" | "claim_structure" | "cta_style" | "address_form" | "uses_numbers" | "visual_style" | "pacing" | "music_energy" | "duration" | "hook_type_x_persona";

export interface PatternEvidence { adId: string; adName?: string; percentile: number; hookRate?: number; ctr?: number; hookText?: string; isWinner: boolean }
export interface Pattern {
  id: string;
  dimension: PatternDimension;
  value: string;
  sampleSize: number;
  winnerShare: number;
  /** Mean percentile of ads with this value ÷ overall mean percentile. >1 is good. */
  lift: number;
  hookLift?: number;
  ctrLift?: number;
  direction: "positive" | "negative";
  evidence: PatternEvidence[];
  summaryEn: string;
  summaryDe: string;
  platform?: string;
  updatedAt: string;
}

export interface MineOptions { minSample?: number; minLift?: number; comboMinSample?: number; now?: string }

const LABELS: Record<PatternDimension, string> = {
  hook_type: "Hook type", angle: "Angle", persona: "Persona", emotional_trigger: "Emotional trigger", claim_structure: "Claim structure",
  cta_style: "CTA style", address_form: "Address form", uses_numbers: "Numbers in copy", visual_style: "Visual style", pacing: "Pacing",
  music_energy: "Music", duration: "Duration", hook_type_x_persona: "Hook × persona",
};
const LABELS_DE: Record<PatternDimension, string> = {
  hook_type: "Hook-Typ", angle: "Angle", persona: "Zielgruppe", emotional_trigger: "Emotionaler Trigger", claim_structure: "Claim-Struktur",
  cta_style: "CTA-Stil", address_form: "Anrede", uses_numbers: "Zahlen im Text", visual_style: "Visueller Stil", pacing: "Schnittfrequenz",
  music_energy: "Musik", duration: "Länge", hook_type_x_persona: "Hook × Zielgruppe",
};

function pacingBucket(cutsPer10s: number | undefined): string | undefined {
  if (cutsPer10s === undefined) return undefined;
  if (cutsPer10s < 1.5) return "slow (<1.5 cuts/10s)";
  if (cutsPer10s < 4) return "medium (1.5–4 cuts/10s)";
  return "fast (4+ cuts/10s)";
}
function durationBucket(s: number | undefined): string | undefined {
  if (s === undefined) return undefined;
  if (s < 20) return "under 20s";
  if (s <= 35) return "20–35s";
  return "over 35s";
}

/** Every dimension value a teardown contributes to. */
export function dimensionValues(t: Teardown): Array<[PatternDimension, string]> {
  const out: Array<[PatternDimension, string]> = [];
  const s = t.structure;
  if (s) {
    out.push(["hook_type", s.hookType], ["angle", s.angle], ["persona", s.persona], ["emotional_trigger", s.emotionalTrigger],
      ["claim_structure", s.claimStructure], ["cta_style", s.ctaStyle], ["address_form", s.addressForm], ["uses_numbers", s.usesNumbers ? "yes" : "no"],
      ["hook_type_x_persona", `${s.hookType} × ${s.persona}`]);
  }
  if (t.visual.visualStyle !== "unknown") out.push(["visual_style", t.visual.visualStyle]);
  const pacing = pacingBucket(t.visual.cutsPer10s); if (pacing) out.push(["pacing", pacing]);
  if (t.visual.musicEnergy !== "unknown") out.push(["music_energy", t.visual.musicEnergy]);
  const dur = durationBucket(t.visual.durationS); if (dur) out.push(["duration", dur]);
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const fmtX = (x: number) => `${x.toFixed(x >= 10 ? 0 : 1)}×`;
const fmtXDe = (x: number) => fmtX(x).replace(".", ",");

export function minePatterns(teardowns: Teardown[], scores: AdScore[], opts: MineOptions = {}): Pattern[] {
  const minSample = opts.minSample ?? 5, minLift = opts.minLift ?? 0.15, comboMin = opts.comboMinSample ?? 8;
  const now = opts.now ?? new Date().toISOString();
  const scoreById = new Map(scores.map((s) => [s.adId, s]));
  const rows = teardowns.filter((t) => t.status === "done" && scoreById.has(t.adId)).map((t) => ({ t, s: scoreById.get(t.adId)! }));
  if (rows.length < minSample) return [];
  const overallPct = mean(rows.map((r) => r.s.percentile)) ?? 0.5;
  const overallHook = mean(rows.filter((r) => r.s.hookRate !== undefined).map((r) => r.s.hookRate!));
  const overallCtr = mean(rows.filter((r) => r.s.ctr !== undefined).map((r) => r.s.ctr!));

  const groups = new Map<string, { dimension: PatternDimension; value: string; rows: typeof rows }>();
  for (const r of rows) {
    for (const [dimension, value] of dimensionValues(r.t)) {
      const key = `${dimension}:${value}`;
      const g = groups.get(key) ?? { dimension, value, rows: [] };
      g.rows.push(r); groups.set(key, g);
    }
  }

  const patterns: Pattern[] = [];
  for (const [id, g] of groups) {
    const need = g.dimension === "hook_type_x_persona" ? comboMin : minSample;
    if (g.rows.length < need || g.rows.length === rows.length) continue;
    const pct = mean(g.rows.map((r) => r.s.percentile)) ?? overallPct;
    const lift = overallPct > 0 ? pct / overallPct : 1;
    if (Math.abs(lift - 1) < minLift) continue;
    const hook = mean(g.rows.filter((r) => r.s.hookRate !== undefined).map((r) => r.s.hookRate!));
    const ctr = mean(g.rows.filter((r) => r.s.ctr !== undefined).map((r) => r.s.ctr!));
    const hookLift = hook !== undefined && overallHook ? hook / overallHook : undefined;
    const ctrLift = ctr !== undefined && overallCtr ? ctr / overallCtr : undefined;
    const winnerShare = g.rows.filter((r) => r.s.isWinner).length / g.rows.length;
    const direction = lift >= 1 ? "positive" : "negative";
    const evidence = [...g.rows].sort((a, b) => b.s.percentile - a.s.percentile).slice(0, 3).map((r) => ({
      adId: r.s.adId, adName: r.t.adName, percentile: r.s.percentile, hookRate: r.s.hookRate, ctr: r.s.ctr, hookText: r.t.structure?.hookText, isWinner: r.s.isWinner,
    }));
    const kpi = hookLift !== undefined ? ` · ${fmtX(hookLift)} hook rate` : ctrLift !== undefined ? ` · ${fmtX(ctrLift)} CTR` : "";
    const kpiDe = hookLift !== undefined ? ` · ${fmtXDe(hookLift)} Hook-Rate` : ctrLift !== undefined ? ` · ${fmtXDe(ctrLift)} CTR` : "";
    const n = g.rows.length;
    patterns.push({
      id, dimension: g.dimension, value: g.value, sampleSize: n, winnerShare: Number(winnerShare.toFixed(3)), lift: Number(lift.toFixed(2)),
      hookLift: hookLift === undefined ? undefined : Number(hookLift.toFixed(2)), ctrLift: ctrLift === undefined ? undefined : Number(ctrLift.toFixed(2)),
      direction, evidence,
      summaryEn: direction === "positive"
        ? `${LABELS[g.dimension]} "${g.value}" ranks ${fmtX(lift)} higher than average${kpi} (n=${n}, ${Math.round(winnerShare * 100)}% winners).`
        : `${LABELS[g.dimension]} "${g.value}" ranks below average (${fmtX(lift)})${kpi} (n=${n}); avoid unless the brief demands it.`,
      summaryDe: direction === "positive"
        ? `${LABELS_DE[g.dimension]} „${g.value}“ rankt ${fmtXDe(lift)} über dem Schnitt${kpiDe} (n=${n}, ${Math.round(winnerShare * 100)} % Gewinner).`
        : `${LABELS_DE[g.dimension]} „${g.value}“ rankt unter dem Schnitt (${fmtXDe(lift)})${kpiDe} (n=${n}); vermeiden, außer das Briefing verlangt es.`,
      updatedAt: now,
    });
  }
  return patterns.sort((a, b) => Math.abs(b.lift - 1) * Math.sqrt(b.sampleSize) - Math.abs(a.lift - 1) * Math.sqrt(a.sampleSize));
}

export interface KbOptions {
  maxPositive?: number; maxNegative?: number; maxExamples?: number; disabledIds?: Set<string>;
  /** Meta-signal: how accepted suggestions citing each pattern turned out. */
  outcomes?: Map<string, { won: number; lost: number; mixed: number; pending: number }>;
}

/** Example hooks from the best-ranked torn-down ads, winners first. */
export function winningHooks(teardowns: Teardown[], scores: AdScore[], max = 3): Array<{ adId: string; adName?: string; hookText: string; hookType?: string; percentile: number }> {
  const byId = new Map(scores.map((s) => [s.adId, s]));
  return teardowns
    .filter((t) => t.status === "done" && t.structure?.hookText && byId.has(t.adId))
    .map((t) => ({ t, s: byId.get(t.adId)! }))
    .sort((a, b) => Number(b.s.isWinner) - Number(a.s.isWinner) || b.s.percentile - a.s.percentile)
    .slice(0, max)
    .map(({ t, s }) => ({ adId: t.adId, adName: t.adName, hookText: t.structure!.hookText, hookType: t.structure!.hookType, percentile: s.percentile }));
}

/** The compact text block injected into script prompts. Everything inside is data, not instructions. */
export function kbForPrompt(patterns: Pattern[], hooks: ReturnType<typeof winningHooks>, opts: KbOptions = {}): string {
  const disabled = opts.disabledIds ?? new Set<string>();
  const live = patterns.filter((p) => !disabled.has(p.id));
  const positive = live.filter((p) => p.direction === "positive").slice(0, opts.maxPositive ?? 12);
  const negative = live.filter((p) => p.direction === "negative").slice(0, opts.maxNegative ?? 5);
  if (!positive.length && !negative.length && !hooks.length) return "";
  const lines: string[] = ["<winning_patterns source=\"own ad performance data\">"];
  const applied = (id: string) => {
    const o = opts.outcomes?.get(id);
    if (!o || o.won + o.lost + o.mixed === 0) return "";
    return ` Applied in new ads since: ${o.won} won, ${o.lost} lost${o.mixed ? `, ${o.mixed} mixed` : ""}.`;
  };
  if (positive.length) { lines.push("What works:"); for (const p of positive) lines.push(`- [${p.id}] ${p.summaryEn.slice(0, 160)}${applied(p.id)}`); }
  if (negative.length) { lines.push("What underperforms:"); for (const p of negative) lines.push(`- [${p.id}] ${p.summaryEn.slice(0, 160)}${applied(p.id)}`); }
  if (hooks.length) { lines.push("Best-performing hooks (German, verbatim):"); for (const h of hooks.slice(0, opts.maxExamples ?? 3)) lines.push(`- (${h.hookType ?? "hook"}) "${h.hookText.slice(0, 160)}"`); }
  lines.push("</winning_patterns>");
  return lines.join("\n");
}
