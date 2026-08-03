/**
 * Tunable constants for the round-reduction survival ladder.
 * Advisory only — never blocks a bet.
 */

export type ConfTier = "A" | "B" | "C";

export type ConfTiers = {
  A: number;
  B: number;
  C: number;
};

export const LADDER_CONFIG = {
  /** Fill strongest-first; lower tiers backfill only to reach LADDER_SIZE. */
  CONF_TIERS: { A: 0.55, B: 0.45, C: 0.35 } as ConfTiers,
  /** Nothing below this ever enters, even to reach 10. */
  HARD_MIN: 0.35,
  /** Initial per-league cap; auto-relaxes +1 among current-tier pool only. */
  MAX_PER_LEAGUE: 3,
  /** Soft target for how many leagues to represent when possible. */
  TARGET_MIN_LEAGUES: 3,
  /** Rank-score window for same-tier correlation-aware drop-order ties. */
  TIE_BAND: 0.03,
  /** Max legs in the ladder. */
  LADDER_SIZE: 10,
} as const;

/** Compat: Tier A primary floor. */
export const CONF_FLOOR = LADDER_CONFIG.CONF_TIERS.A;

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

/**
 * Resolve Tier A/B/C floors from an optional Tier-A slider value.
 * B = max(HARD_MIN, A - 0.10), C = HARD_MIN; ensures A >= B >= C.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function resolveConfTiers(tierA?: number): ConfTiers {
  const hardMin = LADDER_CONFIG.HARD_MIN;
  const defaults = LADDER_CONFIG.CONF_TIERS;
  const rawA =
    tierA != null && Number.isFinite(tierA) ? tierA : defaults.A;
  const A = round2(Math.max(hardMin, rawA));
  const B = round2(Math.min(A, Math.max(hardMin, A - 0.1)));
  const C = hardMin;
  return { A, B, C };
}

export function tierRank(tier: ConfTier): number {
  return tier === "C" ? 0 : tier === "B" ? 1 : 2;
}
