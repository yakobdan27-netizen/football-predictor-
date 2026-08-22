/**
 * Season roster stats from system_season_fixtures (primary 2026/27 source).
 */
import { standardizeTeamName } from "@/lib/data/team-names";
import { apiLeagueId } from "@/lib/football-api/leagues";
import { getTeamRatesByName, listTeamFixturesForSeason } from "./store";
import { SYSTEM_SEASON_YEAR } from "./constants";

export type SystemSeasonTeamMatchStats = {
  matches: number;
  goalsFor: number;
  goalsAgainst: number;
  over25: number;
  btts: number;
};

const EMPTY_STATS: SystemSeasonTeamMatchStats = {
  matches: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  over25: 0,
  btts: 0,
};

/** Prefer auto-collected system season; fall back to KV batch FT counts. */
export function primaryFtSeasonStats(
  systemSeason: SystemSeasonTeamMatchStats | undefined,
  batchLive: SystemSeasonTeamMatchStats
): SystemSeasonTeamMatchStats {
  if (systemSeason && systemSeason.matches > 0) return systemSeason;
  return batchLive;
}

export async function preloadRosterStatsForTeams(
  league: string,
  teams: readonly string[]
): Promise<Map<string, SystemSeasonTeamMatchStats>> {
  const out = new Map<string, SystemSeasonTeamMatchStats>();
  await Promise.all(
    teams.map(async (team) => {
      const stats = await countSystemSeasonTeamMatches(team, league);
      out.set(standardizeTeamName(team), stats);
    })
  );
  return out;
}

export { EMPTY_STATS as emptySystemSeasonTeamStats };

export async function countSystemSeasonTeamMatches(
  team: string,
  league: string,
  season: number = SYSTEM_SEASON_YEAR
): Promise<SystemSeasonTeamMatchStats> {
  const leagueId = apiLeagueId(league);
  if (leagueId == null) {
    return { matches: 0, goalsFor: 0, goalsAgainst: 0, over25: 0, btts: 0 };
  }

  const key = standardizeTeamName(team).toLowerCase();
  const rateRow = await getTeamRatesByName(team, leagueId, season);
  const teamId = rateRow?.teamId;
  if (teamId == null) {
    return { matches: 0, goalsFor: 0, goalsAgainst: 0, over25: 0, btts: 0 };
  }

  const fixtures = await listTeamFixturesForSeason(teamId, leagueId, season);
  let matches = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let over25 = 0;
  let btts = 0;

  for (const f of fixtures) {
    if (f.ftHome == null || f.ftAway == null) continue;
    const homeKey = standardizeTeamName(f.homeTeam).toLowerCase();
    const awayKey = standardizeTeamName(f.awayTeam).toLowerCase();
    const isHome = homeKey === key;
    const isAway = awayKey === key;
    if (!isHome && !isAway) continue;

    matches++;
    const gf = isHome ? f.ftHome : f.ftAway;
    const ga = isHome ? f.ftAway : f.ftHome;
    goalsFor += gf;
    goalsAgainst += ga;
    if (f.ftHome + f.ftAway > 2) over25++;
    if (f.ftHome > 0 && f.ftAway > 0) btts++;
  }

  return { matches, goalsFor, goalsAgainst, over25, btts };
}
