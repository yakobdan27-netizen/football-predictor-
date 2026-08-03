/**
 * Tunable constants for 2H-heavy (P(2H > 1H)) ranking.
 * Advisory only — never blocks a pick.
 *
 * Per-league BETA_2H: use beta2hFor(league) from @/lib/hist/recompute-betas
 * (fallback remains BETA_2H = 1.15).
 * Per-league goals/game: leagueTotalFor prefers warmed hist cache.
 */

import { leagueTotalFromCache } from "@/lib/hist/league-total-cache";
import {
  DEFAULT_LEAGUE_TOTAL,
  LEAGUE_TOTAL,
} from "./static-league-totals";

export const BETA_2H = 1.15;
export const MIN_MATCHES = 8;
export const RECENCY_DAYS = 60;
export const RECENCY_PENALTY = 0.85;
export const POISSON_CAP = 10;

export { LEAGUE_TOTAL, DEFAULT_LEAGUE_TOTAL };

/** Future formation multiplier; unused in v1 math (always 1.0). */
export const FORMATION_ADJUST = 1.0;

export function leagueTotalFor(league: string): number {
  return leagueTotalFromCache(league);
}
