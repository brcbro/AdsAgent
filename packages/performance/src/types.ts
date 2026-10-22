export type Platform = "meta" | "google";
export type Confidence = "low" | "medium" | "high";

export interface AdAccount {
  id: string;
  platform: Platform;
  externalId: string;
  name: string;
  currency?: string;
  timezone?: string;
  status: "connected" | "csv" | "disconnected";
  lastSyncAt?: string;
}

/** One creative on a platform; stable across days. `id` is `<platform>:<external id>`. */
export interface PlatformAd {
  id: string;
  accountId: string;
  platform: Platform;
  externalId: string;
  name: string;
  campaignName?: string;
  adsetName?: string;
  creativeVideoUrl?: string;
  thumbnailUrl?: string;
  projectId?: string;
  variantKey?: string;
  firstSeen: string;
  lastSeen: string;
  status?: string;
}

/** Daily metrics normalized across platforms. Missing values are `undefined`, never 0. */
export interface AdMetricsDaily {
  adId: string;
  date: string; // YYYY-MM-DD
  impressions?: number;
  reach?: number;
  spend?: number;
  clicks?: number;
  linkClicks?: number;
  videoPlays3s?: number;
  /** Any video start (Meta `video_play_actions`); kept in the raw payload only, not stored or scored. */
  videoPlaysAny?: number;
  videoThruplays?: number;
  videoP25?: number;
  videoP50?: number;
  videoP75?: number;
  videoP100?: number;
  views?: number;
  viewRate?: number;
  conversions?: number;
  conversionValue?: number;
  leads?: number;
  raw?: Record<string, string>;
}

/** Metrics summed over a window for one ad. */
export interface AdWindowTotals {
  adId: string;
  accountId: string;
  platform: Platform;
  days: number;
  impressions: number;
  spend: number;
  clicks: number;
  linkClicks: number;
  videoPlays3s?: number;
  videoThruplays?: number;
  videoP25?: number;
  videoP100?: number;
  views?: number;
  conversions?: number;
  conversionValue?: number;
}

export interface ScoreWeights {
  hook: number;
  hold: number;
  ctr: number;
  cpa: number;
  roas: number;
}

export interface ScoreThresholds {
  /** Below either → confidence "low" and excluded from winner/loser picks. */
  mediumImpressions: number;
  mediumSpend: number;
  highImpressions: number;
  highSpend: number;
  /** Share of eligible ads flagged as winners (top) and losers (bottom). */
  winnerShare: number;
  loserShare: number;
  /** Floor for the prior weight (in impressions) pulling low-volume rates toward the account mean; the group median is used when larger. */
  shrinkageImpressions: number;
  /** 7-day KPI below this fraction of the 30-day KPI flags fatigue on a winner. */
  fatigueRatio: number;
}

export interface AdScore {
  adId: string;
  windowDays: number;
  impressions: number;
  spend: number;
  hookRate?: number;
  holdRate?: number;
  ctr?: number;
  cpc?: number;
  cpa?: number;
  roas?: number;
  completionRate?: number;
  score: number;
  percentile: number;
  isWinner: boolean;
  isLoser: boolean;
  isFatigued: boolean;
  confidence: Confidence;
  computedAt: string;
}

export const DEFAULT_WEIGHTS: ScoreWeights = { hook: 0.25, hold: 0.2, ctr: 0.2, cpa: 0.25, roas: 0.1 };

export const DEFAULT_THRESHOLDS: ScoreThresholds = {
  mediumImpressions: 1000,
  mediumSpend: 20,
  highImpressions: 10_000,
  highSpend: 100,
  winnerShare: 0.15,
  loserShare: 0.2,
  shrinkageImpressions: 5000,
  fatigueRatio: 0.7,
};
