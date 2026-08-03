/**
 * Tunable constants for the round-reduction survival ladder.
 * Advisory only — never blocks a bet.
 */

export const LADDER_CONFIG = {
  /** Hard gate — never relaxed for league balance. */
  CONF_FLOOR: 0.55,
  /** Initial per-league cap; auto-relaxes +1 among floor-passers only. */
  MAX_PER_LEAGUE: 3,
  /** Soft target for how many leagues to represent when possible. */
  TARGET_MIN_LEAGUES: 3,
  /** Survival-score window for correlation-aware drop-order ties. */
  TIE_BAND: 0.03,
  /** Max legs in the ladder. */
  LADDER_SIZE: 10,
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
  confFloor?: number;
  maxPerLeague?: number;
};
