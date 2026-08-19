/**
 * API-Football season GF/GA → Poisson λ pair (same interaction as seed priors).
 */
import {
  fetchTeamSeasonStatistics,
  getCachedTeamSeasonStatistics,
} from "@/lib/football-api/team-statistics";
import { resolveApiTeamId } from "@/lib/football-api/team-id-map";
import { apiLeagueId, apiSeasonFromDate } from "@/lib/football-api/leagues";
import { lookupLeagueHalfBaseline } from "./half-goals-baselines";
import { STAT_ENGINE_CONFIG } from "./stat-engine-config";

const HOME_SCORE_FACTOR = 1.1;
const AWAY_SCORE_FACTOR = 0.9;
const HOME_CONCEDE_FACTOR = 0.95;
const AWAY_CONCEDE_FACTOR = 1.05;

/** Minimum league fixtures before API rates feed the 60% blend. */
export const LEAGUE_MATCHUP_MIN_API_PLAYED = 5;

export type ApiMatchupLambdas = {
  lambdaHome: number;
  lambdaAway: number;
  source: string;
  homePlayed: number;
  awayPlayed: number;
};

function interactionLambdas(
  homeScored: number,
  awayScored: number,
  homeConc: number,
  awayConc: number,
  league: string
): { lambdaHome: number; lambdaAway: number } {
  const lg = lookupLeagueHalfBaseline(league);
  const lgGoals =
    lg?.avgGoals ??
    STAT_ENGINE_CONFIG.DEFAULT_LEAGUE_HOME_GOALS +
      STAT_ENGINE_CONFIG.DEFAULT_LEAGUE_AWAY_GOALS;
  const lgHome = Math.max(0.5, lgGoals * 0.55);
  const lgAway = Math.max(0.4, lgGoals * 0.45);

  const homeFor = homeScored * HOME_SCORE_FACTOR;
  const awayFor = awayScored * AWAY_SCORE_FACTOR;
  const homeAgainst = homeConc * HOME_CONCEDE_FACTOR;
  const awayAgainst = awayConc * AWAY_CONCEDE_FACTOR;

  return {
    lambdaHome: Math.max(0.15, homeFor * (awayAgainst / lgHome)),
    lambdaAway: Math.max(0.15, awayFor * (homeAgainst / lgAway)),
  };
}

function ratesFromSeasonStats(
  goalsFor: number | null,
  goalsAgainst: number | null,
  played: number | null
): { scored: number; conceded: number } | null {
  if (
    goalsFor == null ||
    goalsAgainst == null ||
    played == null ||
    played < LEAGUE_MATCHUP_MIN_API_PLAYED
  ) {
    return null;
  }
  return {
    scored: goalsFor / played,
    conceded: goalsAgainst / played,
  };
}

async function loadTeamRates(
  leagueId: number,
  season: number,
  teamId: number,
  useCacheOnly: boolean
) {
  if (useCacheOnly) {
    return getCachedTeamSeasonStatistics(leagueId, season, teamId);
  }
  return fetchTeamSeasonStatistics(leagueId, season, teamId);
}

/**
 * Season GF/GA from API → λ_home / λ_away. Returns null when IDs or sample missing.
 */
export async function apiCorrectScoreLambdas(
  homeClub: string,
  awayClub: string,
  league: string,
  opts?: { season?: number; cacheOnly?: boolean }
): Promise<ApiMatchupLambdas | null> {
  const leagueId = apiLeagueId(league);
  if (leagueId == null) return null;

  const season =
    opts?.season ?? apiSeasonFromDate(new Date().toISOString().slice(0, 10));
  const cacheOnly = opts?.cacheOnly === true;

  const homeLookup = await resolveApiTeamId({
    teamName: homeClub,
    league,
    season,
  });
  const awayLookup = await resolveApiTeamId({
    teamName: awayClub,
    league,
    season,
  });
  if (homeLookup.teamId == null || awayLookup.teamId == null) return null;

  const [homeStats, awayStats] = await Promise.all([
    loadTeamRates(leagueId, season, homeLookup.teamId, cacheOnly),
    loadTeamRates(leagueId, season, awayLookup.teamId, cacheOnly),
  ]);

  const homeRates = ratesFromSeasonStats(
    homeStats?.goalsFor ?? null,
    homeStats?.goalsAgainst ?? null,
    homeStats?.played ?? null
  );
  const awayRates = ratesFromSeasonStats(
    awayStats?.goalsFor ?? null,
    awayStats?.goalsAgainst ?? null,
    awayStats?.played ?? null
  );
  if (!homeRates || !awayRates) return null;

  const { lambdaHome, lambdaAway } = interactionLambdas(
    homeRates.scored,
    awayRates.scored,
    homeRates.conceded,
    awayRates.conceded,
    league
  );

  return {
    lambdaHome,
    lambdaAway,
    source: `api:teams/statistics ${season} (n≥${LEAGUE_MATCHUP_MIN_API_PLAYED})`,
    homePlayed: homeStats!.played!,
    awayPlayed: awayStats!.played!,
  };
}
