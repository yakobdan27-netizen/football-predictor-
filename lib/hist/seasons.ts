/**
 * Season window for hist_* backfill: previous 11 completed + current.
 * Single source of truth for competitions — iterate HIST_LEAGUES everywhere.
 */
import { LEAGUE_API_IDS, apiSeasonFromDate } from "@/lib/football-api/leagues";
import type { LeagueOption } from "@/lib/prediction-log/markets-config";

export type HistCompType = "league" | "cup";

export type HistLeagueDef = {
  name: LeagueOption;
  id: number;
  type: HistCompType;
};

/** Config-driven competition list — add/remove here only. */
export const HIST_LEAGUES: readonly HistLeagueDef[] = [
  {
    name: "Premier League",
    id: LEAGUE_API_IDS["Premier League"],
    type: "league",
  },
  { name: "La Liga", id: LEAGUE_API_IDS["La Liga"], type: "league" },
  { name: "Serie A", id: LEAGUE_API_IDS["Serie A"], type: "league" },
  { name: "Bundesliga", id: LEAGUE_API_IDS.Bundesliga, type: "league" },
  { name: "Ligue 1", id: LEAGUE_API_IDS["Ligue 1"], type: "league" },
  {
    name: "UEFA Champions League",
    id: LEAGUE_API_IDS["UEFA Champions League"],
    type: "cup",
  },
] as const;

/** Domestic leagues only (exclude cups from intensity / BETA / priors). */
export const HIST_DOMESTIC_LEAGUES: HistLeagueDef[] = HIST_LEAGUES.filter(
  (l) => l.type === "league"
);

/** @deprecated Use HIST_LEAGUES or HIST_DOMESTIC_LEAGUES. */
export const HIST_BIG5_LEAGUES = HIST_DOMESTIC_LEAGUES;

/** Completed seasons in the permanent reference window (plus current when included). */
export const HIST_COMPLETED_SEASON_COUNT = 11;

/**
 * Exponential season decay: w = base ^ seasons_ago.
 * Current/most-recent completed relative to `current` = 1.0.
 */
export const HIST_SEASON_DECAY_BASE = 0.8;

export function histSeasonWeight(
  season: number,
  current: number = currentHistSeason()
): number {
  return Math.pow(HIST_SEASON_DECAY_BASE, Math.max(0, current - season));
}

export function todayIsoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Current European season start year from calendar date. */
export function currentHistSeason(today: Date = new Date()): number {
  return apiSeasonFromDate(todayIsoDate(today));
}

/**
 * Completed seasons: previous 11 start years (e.g. Aug 2026 → 2015…2025).
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

/** Oldest season start year included in the completed window. */
export function histWindowMinSeason(today?: Date): number {
  const current = currentHistSeason(today);
  return current - HIST_COMPLETED_SEASON_COUNT;
}

export function histCompType(leagueId: number): HistCompType {
  const hit = HIST_LEAGUES.find((l) => l.id === leagueId);
  return hit?.type ?? "league";
}

export function histLeagueName(leagueId: number): string {
  return HIST_LEAGUES.find((l) => l.id === leagueId)?.name ?? `League ${leagueId}`;
}

export type HistJobKey = {
  leagueId: number;
  leagueName: string;
  season: number;
  compType: HistCompType;
};

/** All competition × season cells for the backfill window. */
export function histJobKeys(opts?: { today?: Date }): HistJobKey[] {
  const seasons = histSeasonYears({ today: opts?.today });
  const keys: HistJobKey[] = [];
  for (const league of HIST_LEAGUES) {
    for (const season of seasons) {
      keys.push({
        leagueId: league.id,
        leagueName: league.name,
        season,
        compType: league.type,
      });
    }
  }
  return keys;
}
