import { LEAGUE_API_IDS } from "@/lib/football-api/leagues";
import type { LeagueOption } from "@/lib/prediction-log/markets-config";

/**
 * Competitions for historical stats backfill (Big-5 + UCL/UEL).
 * Intentionally separate from LIVE_SYNC_LEAGUES (live poll / daily sweep).
 */
export const STATS_BACKFILL_LEAGUES = [
  "Premier League",
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "UEFA Champions League",
  "UEFA Europa League",
] as const satisfies readonly LeagueOption[];

export type StatsBackfillLeague = (typeof STATS_BACKFILL_LEAGUES)[number];

export const STATS_BACKFILL_LEAGUE_IDS: number[] = STATS_BACKFILL_LEAGUES.map(
  (name) => LEAGUE_API_IDS[name]
);

/** API-Football European start years to inventory + fill. */
export const STATS_BACKFILL_SEASONS = [2021, 2022, 2023, 2024, 2025] as const;

export type StatsBackfillSeason = (typeof STATS_BACKFILL_SEASONS)[number];

/** Per-cron `/stats` cap — keep under ~60s with ~5.2s pacing. */
export const STATS_BACKFILL_MAX_STATS_FETCHES = 15;

export type StatsBackfillPhase = "inventory" | "fill" | "done";

export function backfillCellIndex(
  leagueId: number,
  season: number
): number {
  const li = STATS_BACKFILL_LEAGUE_IDS.indexOf(leagueId);
  const si = STATS_BACKFILL_SEASONS.indexOf(
    season as StatsBackfillSeason
  );
  if (li < 0 || si < 0) return -1;
  return li * STATS_BACKFILL_SEASONS.length + si;
}

export function backfillCellAt(index: number): {
  leagueName: StatsBackfillLeague;
  leagueId: number;
  season: StatsBackfillSeason;
} | null {
  const total =
    STATS_BACKFILL_LEAGUE_IDS.length * STATS_BACKFILL_SEASONS.length;
  if (index < 0 || index >= total) return null;
  const li = Math.floor(index / STATS_BACKFILL_SEASONS.length);
  const si = index % STATS_BACKFILL_SEASONS.length;
  const leagueName = STATS_BACKFILL_LEAGUES[li]!;
  return {
    leagueName,
    leagueId: STATS_BACKFILL_LEAGUE_IDS[li]!,
    season: STATS_BACKFILL_SEASONS[si]!,
  };
}

export function seasonLabelFromAf(season: number): string {
  return `${season}/${String(season + 1).slice(-2)}`;
}
