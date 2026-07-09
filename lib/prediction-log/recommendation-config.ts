import type { LogMarketKey, RecommendationSettings } from "./types";

export const RECO_ENGINE_VERSION = 5;

/** Minimum P_final gap to show a better alternative market on the summary card. */
export const BETTER_ALTERNATIVE_THRESHOLD_PCT = 8;

/** Minimum wins+losses before historical rules apply. */
export const MIN_SAMPLE_FOR_ACTION = 5;

/** Minimum wins+losses for team-specific pick rate. */
export const MIN_TEAM_SAMPLE = 3;

/** Minimum club profile picks before using in recommendations. */
export const MIN_CLUB_PROFILE_SAMPLE = 3;

/** Win rate below this triggers eliminate/revise. */
export const LOW_WIN_RATE_THRESHOLD = 45;

/** Stricter threshold for high-variance markets. */
export const HIGH_VARIANCE_WIN_RATE_THRESHOLD = 50;

export const HIGH_VARIANCE_MARKETS: LogMarketKey[] = ["throw_ins_ou", "offsides_ou"];

/** When no history, scale confidence down by this factor. */
export const COLD_START_CONFIDENCE_FACTOR = 0.85;

/** Odds band upper bounds for capping revised odds. */
export const ODDS_BAND_CEILINGS: Record<string, number> = {
  "1.00-1.50": 1.5,
  "1.51-2.00": 2.0,
  "2.01-2.50": 2.5,
  "2.51-3.00": 3.0,
};

export const DEFAULT_MAX_COMBINED_ODDS = 8.0;
export const MAX_COMBINED_ODDS_OPTIONS = [4, 6, 8, 10] as const;
export const ODDS_FILTER_MIN = 1.4;
export const ODDS_FILTER_MAX = 2.6;
export const ODDS_FILTER_BYPASS_WIN_RATE = 75;
export const HARD_EXCLUDE_WIN_RATE = 40;

export const SIMILARITY_MIN_THRESHOLD = 60;
export const SIMILARITY_CAUTION_THRESHOLD = 70;
export const FINE_ODDS_BUCKET_WIDTH = 0.2;
export const WORST_ODDS_BUCKETS_COUNT = 3;

export const SCORE_WEIGHT_SIMILARITY = 0.6;
export const SCORE_WEIGHT_ODDS_SUCCESS = 0.4;

/** Legacy leg scoring weights (risk-adjusted score). */
export const SCORE_WEIGHT_ACCURACY = 0.5;
export const SCORE_WEIGHT_ODDS_BAND = 0.3;
export const SCORE_WEIGHT_CONFIDENCE = 0.2;

export const RISK_LOW_MAX_ODDS = 4;
export const RISK_MEDIUM_MAX_ODDS = 7;

export const SAFE_TIER_MAX_MATCHES = 3;
export const SAFE_TIER_MAX_RISK = 0.15;
export const BALANCED_TIER_MIN_PFINAL = 58;
export const AGGRESSIVE_TIER_MIN_PFINAL = 52;

export function defaultRecommendationSettings(): RecommendationSettings {
  return {
    oddsFilteringEnabled: true,
    tier1MinPFinal: 72,
    tier3MaxBatchRisk: 0.6,
    tier3AllowAlternativeMarkets: true,
    betterAlternativeThresholdPct: BETTER_ALTERNATIVE_THRESHOLD_PCT,
  };
}

export function isHighVarianceMarket(market: LogMarketKey): boolean {
  return HIGH_VARIANCE_MARKETS.includes(market);
}

export const MATCH_JUDGMENT_LABELS: Record<
  import("./types").MatchJudgmentLabel,
  string
> = {
  strong_keep: "Strong Keep",
  keep_caution: "Keep with caution",
  skip: "Skip – high risk",
};
