/**
 * Refresh team_ratings from hist half intensities (full 11y window).
 */
import { eq } from "drizzle-orm";
import { standardizeTeamName } from "@/lib/data/team-names";
import { getDb } from "@/lib/db";
import { histFixtures, teamRatings } from "@/lib/db/schema";
import { apiLeagueId } from "@/lib/football-api/leagues";
import { clampLambda, SHRINKAGE_K, shrinkRateTowardLeague } from "@/lib/prediction-log/model-config";
import { computeTeamHalfFromHist } from "./team-half-intensities";
import { leagueGoalAverageFromHist } from "./team-half-intensities";
import { HIST_DOMESTIC_LEAGUES } from "./seasons";

function teamKey(name: string): string {
  return standardizeTeamName(name).trim().toLowerCase();
}

/** Distinct Big-5 team names per league from hist_fixtures. */
export async function discoverDomesticTeamsFromHist(): Promise<
  Record<string, string[]>
> {
  const db = await getDb();
  const out: Record<string, string[]> = {};

  for (const league of HIST_DOMESTIC_LEAGUES) {
    const rows = await db
      .select({
        homeTeam: histFixtures.homeTeam,
        awayTeam: histFixtures.awayTeam,
      })
      .from(histFixtures)
      .where(eq(histFixtures.leagueId, league.id));

    const teams = new Map<string, string>();
    for (const r of rows) {
      const hk = teamKey(r.homeTeam);
      const ak = teamKey(r.awayTeam);
      if (!teams.has(hk)) teams.set(hk, standardizeTeamName(r.homeTeam));
      if (!teams.has(ak)) teams.set(ak, standardizeTeamName(r.awayTeam));
    }
    out[league.name] = [...teams.values()].sort();
  }

  return out;
}

export async function persistTeamRatingsForLeague(
  leagueName: string,
  teamNames: string[]
): Promise<number> {
  const leagueId = apiLeagueId(leagueName);
  if (leagueId == null) return 0;
  const db = await getDb();
  const lgAvg = (await leagueGoalAverageFromHist(leagueName)) ?? 2.6;
  const muSide = lgAvg / 2;
  let n = 0;
  const now = new Date();

  for (const team of teamNames) {
    const home = await computeTeamHalfFromHist(team, "home", leagueName);
    const away = await computeTeamHalfFromHist(team, "away", leagueName);
    if (!home && !away) continue;

    const scH = home ? home.sc_1h + home.sc_2h : muSide;
    const scA = away ? away.sc_1h + away.sc_2h : muSide;
    const concH = home ? home.conc_1h + home.conc_2h : muSide;
    const concA = away ? away.conc_1h + away.conc_2h : muSide;
    const nEff = Math.max(home?.ess ?? 0, away?.ess ?? 0);
    const attackHome = clampLambda(
      shrinkRateTowardLeague(scH / Math.max(0.05, muSide), nEff, 1, SHRINKAGE_K)
    );
    const attackAway = clampLambda(
      shrinkRateTowardLeague(scA / Math.max(0.05, muSide), nEff, 1, SHRINKAGE_K)
    );
    const defenceHome = clampLambda(
      shrinkRateTowardLeague(concH / Math.max(0.05, muSide), nEff, 1, SHRINKAGE_K)
    );
    const defenceAway = clampLambda(
      shrinkRateTowardLeague(concA / Math.max(0.05, muSide), nEff, 1, SHRINKAGE_K)
    );
    const lambda1h = (home?.sc_1h ?? 0) + (away?.sc_1h ?? 0);
    const lambda2h = (home?.sc_2h ?? 0) + (away?.sc_2h ?? 0);
    const seasonsUsed = Math.max(home?.seasonsUsed ?? 0, away?.seasonsUsed ?? 0);
    const matchesUsed = (home?.n_matches ?? 0) + (away?.n_matches ?? 0);

    const existing = await db
      .select({ id: teamRatings.id })
      .from(teamRatings)
      .where(eq(teamRatings.teamName, team))
      .limit(1);
    const row = existing.find((r) => r.id != null);
    const payload = {
      teamName: team,
      leagueId,
      attackHome,
      attackAway,
      defenceHome,
      defenceAway,
      cornersIntensity: muSide,
      lambda1h,
      lambda2h,
      ess: nEff,
      seasonsUsed,
      matchesUsed,
      updatedAt: now,
    };
    if (row) {
      await db
        .update(teamRatings)
        .set(payload)
        .where(eq(teamRatings.id, row.id));
    } else {
      await db.insert(teamRatings).values(payload);
    }
    n += 1;
  }
  return n;
}

export async function persistDomesticTeamRatings(
  teamsByLeague: Record<string, string[]>
): Promise<number> {
  let total = 0;
  for (const league of HIST_DOMESTIC_LEAGUES) {
    const teams = teamsByLeague[league.name] ?? [];
    if (!teams.length) continue;
    total += await persistTeamRatingsForLeague(league.name, teams);
  }
  return total;
}

export async function getTeamRating(teamName: string, leagueId: number) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(teamRatings)
    .where(eq(teamRatings.teamName, teamName))
    .limit(1);
  if (row && row.leagueId === leagueId) return row;
  return null;
}
