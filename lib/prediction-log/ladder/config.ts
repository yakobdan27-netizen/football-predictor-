/**
 * Tunable constants for the round-reduction survival ladder.
 * Tiers label quality and set drop order — they never reject a match.
 * Per-league caps spread risk and fully relax before returning short.
 */

export type ConfTier = "A" | "B" | "C";

export type ConfTiers = {
  A: number;
  B: number;
  C: number;
};

export const LADDER_CONFIG = {
  /** Max legs in the ladder (top-N survival ranking). */
  LADDER_SIZE: 10,
  /** Quality labels only — never filter/reject. */
  CONF_TIERS: { A: 0.55, B: 0.45, C: 0.0 } as ConfTiers,
  /** Soft spread cap; auto-relaxes (+1) until ladder is full or pool exhausted. */
  MAX_PER_LEAGUE: 3,
  /** Soft goal: represent at least this many leagues when the pool allows. */
  TARGET_MIN_LEAGUES: 3,
  /** rank_score window for league-concentration drop tie-break. */
  TIE_BAND: 0.03,
} as const;

/** Compat alias for LADDER_CONFIG.LADDER_SIZE. */
export const MAX_LEGS = LADDER_CONFIG.LADDER_SIZE;

export const RISK_THRESHOLD = 0.55;
export const COMBINED_HIGH = 0.1;
export const COMBINED_MEDIUM = 0.25;
export const FILL_FROM_DB = "FILL FROM DB";
/** Floor for stake inverse-probability weights. */
export const STAKE_EPS = 1e-6;

/** Optional per-league overrides (future). */
export type LadderPerLeagueOverride = {
  maxPerLeague?: number;
};

/** Map confidence → tier label. Never alters conf; never rejects. */
export function labelTier(conf: number): ConfTier {
  const { A, B } = LADDER_CONFIG.CONF_TIERS;
  if (conf >= A) return "A";
  if (conf >= B) return "B";
  return "C";
}

/** Higher = stronger tier (A=2, B=1, C=0). Used for drop order. */
export function tierRank(tier: ConfTier): number {
  return tier === "C" ? 0 : tier === "B" ? 1 : 2;
}
