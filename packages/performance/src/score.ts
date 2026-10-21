import {
  type AdScore, type AdWindowTotals, type Confidence, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS,
  type ScoreThresholds, type ScoreWeights,
} from "./types.js";

/*
 * Pure scoring. Input: per-ad totals over a window. Output: creative KPIs, a composite score
 * z-scored within each (account, platform) group, and winner / loser / fatigue flags.
 * Meta and Google never compete on raw numbers; Google's view rate stands in for the
 * 3-second hook rate and its quartiles for hold rate.
 */

export interface RawKpis {
  hookRate?: number;
  holdRate?: number;
  ctr?: number;
  cpc?: number;
  cpa?: number;
  roas?: number;
  completionRate?: number;
}

const ratio = (num: number | undefined, den: number | undefined): number | undefined =>
  num === undefined || den === undefined || den <= 0 ? undefined : num / den;

export function kpis(t: AdWindowTotals): RawKpis {
  const clicks = t.linkClicks || t.clicks;
  const hookRate = t.platform === "meta"
    ? ratio(t.videoPlays3s, t.impressions)
    : ratio(t.views, t.impressions);
  const holdRate = t.platform === "meta"
    ? ratio(t.videoThruplays, t.videoPlays3s)
    : ratio(t.videoP100, t.videoP25);
  return {
    hookRate,
    holdRate,
    completionRate: ratio(t.videoP100, t.impressions),
    ctr: ratio(clicks, t.impressions),
    cpc: ratio(t.spend, clicks),
    cpa: t.conversions && t.conversions > 0 ? t.spend / t.conversions : undefined,
    roas: t.conversionValue !== undefined && t.spend > 0 ? t.conversionValue / t.spend : undefined,
  };
}

export function confidenceFor(t: { impressions: number; spend: number; platform?: string }, th: ScoreThresholds = DEFAULT_THRESHOLDS): Confidence {
  // Google's hook and hold rates are proxies (view rate, quartiles), so a Google ad never reaches "high" on video signals alone.
  if (t.impressions >= th.highImpressions && t.spend >= th.highSpend) return t.platform === "google" ? "medium" : "high";
  if (t.impressions >= th.mediumImpressions && t.spend >= th.mediumSpend) return "medium";
  return "low";
}

/** Empirical-Bayes shrinkage: a rate measured on few impressions is pulled toward the group mean. */
export function shrink(rate: number | undefined, n: number, groupMean: number | undefined, prior: number): number | undefined {
  if (rate === undefined) return undefined;
  if (groupMean === undefined || prior <= 0) return rate;
  return (rate * n + groupMean * prior) / (n + prior);
}

function mean(xs: number[]): number | undefined {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
}
function stddev(xs: number[], m: number): number {
  if (xs.length < 2) return 0;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

type Metric = keyof ScoreWeights;
const METRIC_KEY: Record<Metric, keyof RawKpis> = { hook: "hookRate", hold: "holdRate", ctr: "ctr", cpa: "cpa", roas: "roas" };
/** Lower is better for CPA. */
const INVERTED: Record<Metric, boolean> = { hook: false, hold: false, ctr: false, cpa: true, roas: false };

export interface ScoreInput {
  totals: AdWindowTotals[];
  /** Same ads over the short window, used for fatigue detection. Optional. */
  recent?: AdWindowTotals[];
  weights?: ScoreWeights;
  thresholds?: ScoreThresholds;
  now?: string;
}

export function computeScores({ totals, recent = [], weights = DEFAULT_WEIGHTS, thresholds = DEFAULT_THRESHOLDS, now = new Date().toISOString() }: ScoreInput): AdScore[] {
  const groups = new Map<string, AdWindowTotals[]>();
  for (const t of totals) {
    const key = `${t.platform}|${t.accountId}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const recentById = new Map(recent.map((r) => [r.adId, r]));
  const out: AdScore[] = [];

  for (const group of groups.values()) {
    const raw = group.map((t) => ({ t, k: kpis(t) }));

    // Group means of rate KPIs for shrinkage, weighted by impressions.
    const groupMeanOf = (key: keyof RawKpis) => {
      const rows = raw.filter((r) => r.k[key] !== undefined);
      const n = rows.reduce((a, r) => a + r.t.impressions, 0);
      return n > 0 ? rows.reduce((a, r) => a + (r.k[key] as number) * r.t.impressions, 0) / n : undefined;
    };
    // Conversions and value are shrunk as per-impression rates too, so five lucky purchases don't make a CPA of €5.
    const perImp = (v: number | undefined, t: AdWindowTotals) => (v === undefined || t.impressions <= 0 ? undefined : v / t.impressions);
    const groupMeanPerImp = (pick: (t: AdWindowTotals) => number | undefined) => {
      const rows = group.filter((t) => pick(t) !== undefined);
      const n = rows.reduce((a, t) => a + t.impressions, 0);
      return n > 0 ? rows.reduce((a, t) => a + (pick(t) as number), 0) / n : undefined;
    };
    const means = {
      hookRate: groupMeanOf("hookRate"), holdRate: groupMeanOf("holdRate"), ctr: groupMeanOf("ctr"),
      cr: groupMeanPerImp((t) => t.conversions), vpi: groupMeanPerImp((t) => t.conversionValue),
    };
    // The prior is at least the configured floor and at least the group's median volume, so an account that
    // normally runs ads to 40k impressions treats a 1,200-impression sample as the small sample it is.
    const sortedImp = group.map((t) => t.impressions).sort((a, b) => a - b);
    const median = sortedImp.length ? sortedImp[Math.floor(sortedImp.length / 2)] : 0;
    const prior = Math.max(thresholds.shrinkageImpressions, median);
    const adjusted = raw.map(({ t, k }) => {
      const cr = shrink(perImp(t.conversions, t), t.impressions, means.cr, prior);
      const vpi = shrink(perImp(t.conversionValue, t), t.impressions, means.vpi, prior);
      return {
        t,
        k: {
          ...k,
          hookRate: shrink(k.hookRate, t.impressions, means.hookRate, prior),
          holdRate: shrink(k.holdRate, t.videoPlays3s ?? t.views ?? t.impressions, means.holdRate, prior),
          ctr: shrink(k.ctr, t.impressions, means.ctr, prior),
          cpa: cr && cr > 0 && t.spend > 0 ? t.spend / (cr * t.impressions) : undefined,
          roas: vpi !== undefined && t.spend > 0 ? (vpi * t.impressions) / t.spend : undefined,
        },
      };
    });

    // Z-score each metric within the group; metrics nobody reports are dropped and their weight redistributed.
    const z = new Map<Metric, Map<string, number>>();
    const available: Metric[] = [];
    for (const metric of Object.keys(weights) as Metric[]) {
      const key = METRIC_KEY[metric];
      const values = adjusted.filter((r) => r.k[key] !== undefined).map((r) => ({ id: r.t.adId, v: r.k[key] as number }));
      if (values.length < 2) continue;
      const m = mean(values.map((v) => v.v)) ?? 0;
      const sd = stddev(values.map((v) => v.v), m);
      const scores = new Map<string, number>();
      for (const { id, v } of values) {
        const zs = sd > 0 ? (v - m) / sd : 0;
        scores.set(id, INVERTED[metric] ? -zs : zs);
      }
      z.set(metric, scores);
      available.push(metric);
    }
    const totalWeight = available.reduce((a, m) => a + weights[m], 0) || 1;

    const scored = adjusted.map(({ t, k }) => {
      let score = 0;
      for (const metric of available) {
        const zs = z.get(metric)!.get(t.adId);
        if (zs !== undefined) score += (weights[metric] / totalWeight) * zs;
      }
      return { t, k, score, confidence: confidenceFor(t, thresholds) };
    });

    const eligible = scored.filter((s) => s.confidence !== "low").sort((a, b) => b.score - a.score);
    const winnerCount = Math.max(eligible.length >= 3 ? 1 : 0, Math.floor(eligible.length * thresholds.winnerShare));
    const loserCount = Math.max(eligible.length >= 3 ? 1 : 0, Math.floor(eligible.length * thresholds.loserShare));
    const winners = new Set(eligible.slice(0, winnerCount).map((s) => s.t.adId));
    const losers = new Set(eligible.slice(eligible.length - loserCount).map((s) => s.t.adId).filter((id) => !winners.has(id)));

    const ranked = [...scored].sort((a, b) => a.score - b.score);
    for (const s of scored) {
      const rank = ranked.indexOf(s);
      const percentile = ranked.length > 1 ? rank / (ranked.length - 1) : 1;
      const isWinner = winners.has(s.t.adId);
      let isFatigued = false;
      const r = recentById.get(s.t.adId);
      if (isWinner && r && r.impressions >= thresholds.mediumImpressions) {
        const rk = kpis(r);
        const dropped = (a?: number, b?: number) => a !== undefined && b !== undefined && b > 0 && a < b * thresholds.fatigueRatio;
        isFatigued = dropped(rk.hookRate, s.k.hookRate) || dropped(rk.ctr, s.k.ctr);
      }
      out.push({
        adId: s.t.adId,
        windowDays: s.t.days,
        impressions: s.t.impressions,
        spend: s.t.spend,
        hookRate: s.k.hookRate, holdRate: s.k.holdRate, ctr: s.k.ctr, cpc: s.k.cpc, cpa: s.k.cpa, roas: s.k.roas,
        completionRate: s.k.completionRate,
        score: Number(s.score.toFixed(4)),
        percentile: Number(percentile.toFixed(3)),
        isWinner,
        isLoser: losers.has(s.t.adId),
        isFatigued,
        confidence: s.confidence,
        computedAt: now,
      });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
