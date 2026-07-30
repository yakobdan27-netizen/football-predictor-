/**
 * Tunable constants for the round-reduction survival ladder.
 * Advisory only — never blocks a bet.
 */

export const MAX_LEGS = 10;
export const RISK_THRESHOLD = 0.55;
export const COMBINED_HIGH = 0.1;
export const COMBINED_MEDIUM = 0.25;
export const FILL_FROM_DB = "FILL FROM DB";
/** Floor for stake inverse-probability weights. */
export const STAKE_EPS = 1e-6;
