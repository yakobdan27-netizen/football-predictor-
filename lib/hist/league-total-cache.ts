/**
 * In-memory league goals/game cache (no DB imports — safe for client bundles).
 * Warmed by lib/hist/league-priors warmLeaguePriorsCache / recompute.
 */
import {
  DEFAULT_LEAGUE_TOTAL,
  LEAGUE_TOTAL,
} from "@/lib/prediction-log/two-h-heavy/static-league-totals";

let cachedTotals: Record<string, number> | null = null;

export function setLeagueTotalCache(totals: Record<string, number>): void {
  cachedTotals = { ...totals };
}

export function leagueTotalFromCache(league: string): number {
  const hit = cachedTotals?.[league];
  if (typeof hit === "number" && Number.isFinite(hit) && hit > 0) return hit;
  return LEAGUE_TOTAL[league] ?? DEFAULT_LEAGUE_TOTAL;
}
