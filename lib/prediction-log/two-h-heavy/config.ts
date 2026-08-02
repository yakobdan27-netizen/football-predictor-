/**
 * Tunable constants for 2H-heavy (P(2H > 1H)) ranking.
 * Advisory only — never blocks a pick.
 *
 * Per-league BETA_2H: use beta2hFor(league) from @/lib/hist/recompute-betas
 * (fallback remains BETA_2H = 1.15).
 */

export const BETA_2H = 1.15;
export const MIN_MATCHES = 8;
export const RECENCY_DAYS = 60;
export const RECENCY_PENALTY = 0.85;
export const POISSON_CAP = 10;

/** Full-match expected goals by league (anchor for half split scaling). */
export const LEAGUE_TOTAL: Record<string, number> = {
  "Premier League": 2.85,
  "La Liga": 2.6,
  "Serie A": 2.55,
  Bundesliga: 3.1,
  "Ligue 1": 2.7,
};

export const DEFAULT_LEAGUE_TOTAL = 2.7;

/** Future formation multiplier; unused in v1 math (always 1.0). */
export const FORMATION_ADJUST = 1.0;

export function leagueTotalFor(league: string): number {
  return LEAGUE_TOTAL[league] ?? DEFAULT_LEAGUE_TOTAL;
}
