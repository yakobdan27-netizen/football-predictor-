/**
 * Season window for hist_* backfill: previous 7 completed + current.
 */
import { LEAGUE_API_IDS, apiSeasonFromDate } from "@/lib/football-api/leagues";
import type { LeagueOption } from "@/lib/prediction-log/markets-config";

export const HIST_BIG5_LEAGUES: Array<{ name: LeagueOption; id: number }> = [
  { name: "Premier League", id: LEAGUE_API_IDS["Premier League"] },
  { name: "La Liga", id: LEAGUE_API_IDS["La Liga"] },
  { name: "Serie A", id: LEAGUE_API_IDS["Serie A"] },
  { name: "Bundesliga", id: LEAGUE_API_IDS.Bundesliga },
  { name: "Ligue 1", id: LEAGUE_API_IDS["Ligue 1"] },
];

export const HIST_COMPLETED_SEASON_COUNT = 7;

export function todayIsoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Current European season start year from calendar date. */
export function currentHistSeason(today: Date = new Date()): number {
  return apiSeasonFromDate(todayIsoDate(today));
}

/**
 * Completed seasons: previous 7 start years (e.g. Aug 2026 → 2019…2025).
 * Plus current when includeCurrent (default true).
 */
export function histSeasonYears(opts?: {
  today?: Date;
  includeCurrent?: boolean;
}): number[] {
  const current = currentHistSeason(opts?.today);
  const completed: number[] = [];
  for (let i = HIST_COMPLETED_SEASON_COUNT; i >= 1; i--) {
    completed.push(current - i);
  }
  if (opts?.includeCurrent === false) return completed;
  return [...completed, current];
}

export type HistJobKey = {
  leagueId: number;
  leagueName: string;
  season: number;
};

/** All league × season cells for the backfill window. */
export function histJobKeys(opts?: { today?: Date }): HistJobKey[] {
  const seasons = histSeasonYears({ today: opts?.today });
  const keys: HistJobKey[] = [];
  for (const league of HIST_BIG5_LEAGUES) {
    for (const season of seasons) {
      keys.push({
        leagueId: league.id,
        leagueName: league.name,
        season,
      });
    }
  }
  return keys;
}
