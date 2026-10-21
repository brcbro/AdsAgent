import type { AdScore, Platform, PlatformAd } from "./types.js";

/*
 * Cross-platform normalization check. Scores are z-scored and ranked within each (platform,
 * account) group, so the only things that may be compared across platforms are percentiles and
 * flags. This summary makes that visible: raw KPI means per platform (expected to differ, since
 * Google's view rate is not Meta's 3-second rate) next to percentile means (expected to match).
 */

export interface PlatformSummary {
  platform: Platform;
  accounts: number;
  ads: number;
  eligible: number;
  winners: number;
  losers: number;
  fatigued: number;
  spend: number;
  meanHookRate?: number;
  meanHoldRate?: number;
  meanCtr?: number;
  meanCpa?: number;
  /** Mean percentile of this platform's ads; ≈0.5 by construction when scoring is per group. */
  meanPercentile: number;
  /** How the hook and hold KPIs were measured on this platform. */
  hookRateNote: string;
  holdRateNote: string;
}

export interface NormalizationReport {
  platforms: PlatformSummary[];
  /** True when every platform's mean percentile sits within ±0.1 of 0.5, i.e. no platform is favoured. */
  balanced: boolean;
  notes: string[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

export function normalizationReport(scores: AdScore[], ads: PlatformAd[]): NormalizationReport {
  const adById = new Map(ads.map((a) => [a.id, a]));
  const groups = new Map<Platform, { scores: AdScore[]; accounts: Set<string> }>();
  for (const s of scores) {
    const ad = adById.get(s.adId);
    if (!ad) continue;
    const g = groups.get(ad.platform) ?? { scores: [], accounts: new Set<string>() };
    g.scores.push(s); g.accounts.add(ad.accountId); groups.set(ad.platform, g);
  }
  const platforms: PlatformSummary[] = [];
  for (const [platform, g] of groups) {
    const pick = (f: (s: AdScore) => number | undefined) => mean(g.scores.map(f).filter((v): v is number => v !== undefined));
    platforms.push({
      platform, accounts: g.accounts.size, ads: g.scores.length,
      eligible: g.scores.filter((s) => s.confidence !== "low").length,
      winners: g.scores.filter((s) => s.isWinner).length, losers: g.scores.filter((s) => s.isLoser).length, fatigued: g.scores.filter((s) => s.isFatigued).length,
      spend: g.scores.reduce((a, s) => a + s.spend, 0),
      meanHookRate: pick((s) => s.hookRate), meanHoldRate: pick((s) => s.holdRate), meanCtr: pick((s) => s.ctr), meanCpa: pick((s) => s.cpa),
      meanPercentile: mean(g.scores.map((s) => s.percentile)) ?? 0.5,
      hookRateNote: platform === "meta" ? "3-second plays ÷ impressions" : "view rate (views ÷ impressions); no 3-second metric on Google",
      holdRateNote: platform === "meta" ? "ThruPlays ÷ 3-second plays" : "100% quartile ÷ 25% quartile",
    });
  }
  platforms.sort((a, b) => a.platform.localeCompare(b.platform));
  const notes: string[] = [];
  const balanced = platforms.every((p) => p.ads < 2 || Math.abs(p.meanPercentile - 0.5) <= 0.1);
  if (platforms.length > 1) notes.push("Scores are ranked within each platform and account; compare percentiles and flags across platforms, never raw hook rates.");
  for (const p of platforms) {
    if (p.ads >= 2 && Math.abs(p.meanPercentile - 0.5) > 0.1) notes.push(`${p.platform}: mean percentile ${p.meanPercentile.toFixed(2)} — a platform is being favoured; check that its ads are scored in their own group.`);
    if (p.platform === "google" && p.winners > 0) notes.push("Google winners are chosen on view rate and quartiles; their confidence is capped at medium, so they are not proposed for scaling until Meta-grade signals exist.");
  }
  return { platforms, balanced, notes };
}
