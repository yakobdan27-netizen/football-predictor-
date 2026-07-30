import type { NewTeamSeasonStats } from "@/lib/db/schema";
import {
  listMatchStatsForLeagueSeason,
  upsertTeamSeasonStatsRows,
} from "./stats-backfill-store";

type Acc = {
  teamName: string;
  afTeamId: number | null;
  matches: number;
  homeMatches: number;
  awayMatches: number;
  goalsFor: number;
  goalsAgainst: number;
  xgFor: number;
  xgAgainst: number;
  shotsFor: number;
  shotsAgainst: number;
  sotFor: number;
  sotAgainst: number;
  cornersFor: number;
  cornersAgainst: number;
  possession: number;
  foulsFor: number;
  yellowFor: number;
  redFor: number;
  passesFor: number;
  tacklesFor: number;
  nGoals: number;
  nXg: number;
  nShots: number;
  nSot: number;
  nCorners: number;
  nPoss: number;
  nFouls: number;
  nYellow: number;
  nRed: number;
  nPasses: number;
  nTackles: number;
  homeGoalsFor: number;
  homeCornersFor: number;
  homeSotFor: number;
  nHomeGoals: number;
  nHomeCorners: number;
  nHomeSot: number;
  awayGoalsFor: number;
  awayCornersFor: number;
  awaySotFor: number;
  nAwayGoals: number;
  nAwayCorners: number;
  nAwaySot: number;
};

function emptyAcc(teamName: string, afTeamId: number | null): Acc {
  return {
    teamName,
    afTeamId,
    matches: 0,
    homeMatches: 0,
    awayMatches: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    xgFor: 0,
    xgAgainst: 0,
    shotsFor: 0,
    shotsAgainst: 0,
    sotFor: 0,
    sotAgainst: 0,
    cornersFor: 0,
    cornersAgainst: 0,
    possession: 0,
    foulsFor: 0,
    yellowFor: 0,
    redFor: 0,
    passesFor: 0,
    tacklesFor: 0,
    nGoals: 0,
    nXg: 0,
    nShots: 0,
    nSot: 0,
    nCorners: 0,
    nPoss: 0,
    nFouls: 0,
    nYellow: 0,
    nRed: 0,
    nPasses: 0,
    nTackles: 0,
    homeGoalsFor: 0,
    homeCornersFor: 0,
    homeSotFor: 0,
    nHomeGoals: 0,
    nHomeCorners: 0,
    nHomeSot: 0,
    awayGoalsFor: 0,
    awayCornersFor: 0,
    awaySotFor: 0,
    nAwayGoals: 0,
    nAwayCorners: 0,
    nAwaySot: 0,
  };
}

function avg(sum: number, n: number): number | null {
  if (n <= 0) return null;
  return Math.round((sum / n) * 100) / 100;
}

function addSide(
  acc: Acc,
  venue: "home" | "away",
  forSide: {
    goals: number | null;
    against: number | null;
    xg: number | null;
    xgAgainst: number | null;
    shots: number | null;
    shotsAgainst: number | null;
    sot: number | null;
    sotAgainst: number | null;
    corners: number | null;
    cornersAgainst: number | null;
    possession: number | null;
    fouls: number | null;
    yellow: number | null;
    red: number | null;
    passes: number | null;
    tackles: number | null;
  }
) {
  acc.matches += 1;
  if (venue === "home") acc.homeMatches += 1;
  else acc.awayMatches += 1;

  if (forSide.goals != null && forSide.against != null) {
    acc.goalsFor += forSide.goals;
    acc.goalsAgainst += forSide.against;
    acc.nGoals += 1;
    if (venue === "home") {
      acc.homeGoalsFor += forSide.goals;
      acc.nHomeGoals += 1;
    } else {
      acc.awayGoalsFor += forSide.goals;
      acc.nAwayGoals += 1;
    }
  }
  if (forSide.xg != null && forSide.xgAgainst != null) {
    acc.xgFor += forSide.xg;
    acc.xgAgainst += forSide.xgAgainst;
    acc.nXg += 1;
  }
  if (forSide.shots != null && forSide.shotsAgainst != null) {
    acc.shotsFor += forSide.shots;
    acc.shotsAgainst += forSide.shotsAgainst;
    acc.nShots += 1;
  }
  if (forSide.sot != null && forSide.sotAgainst != null) {
    acc.sotFor += forSide.sot;
    acc.sotAgainst += forSide.sotAgainst;
    acc.nSot += 1;
    if (venue === "home") {
      acc.homeSotFor += forSide.sot;
      acc.nHomeSot += 1;
    } else {
      acc.awaySotFor += forSide.sot;
      acc.nAwaySot += 1;
    }
  }
  if (forSide.corners != null && forSide.cornersAgainst != null) {
    acc.cornersFor += forSide.corners;
    acc.cornersAgainst += forSide.cornersAgainst;
    acc.nCorners += 1;
    if (venue === "home") {
      acc.homeCornersFor += forSide.corners;
      acc.nHomeCorners += 1;
    } else {
      acc.awayCornersFor += forSide.corners;
      acc.nAwayCorners += 1;
    }
  }
  if (forSide.possession != null) {
    acc.possession += forSide.possession;
    acc.nPoss += 1;
  }
  if (forSide.fouls != null) {
    acc.foulsFor += forSide.fouls;
    acc.nFouls += 1;
  }
  if (forSide.yellow != null) {
    acc.yellowFor += forSide.yellow;
    acc.nYellow += 1;
  }
  if (forSide.red != null) {
    acc.redFor += forSide.red;
    acc.nRed += 1;
  }
  if (forSide.passes != null) {
    acc.passesFor += forSide.passes;
    acc.nPasses += 1;
  }
  if (forSide.tackles != null) {
    acc.tacklesFor += forSide.tackles;
    acc.nTackles += 1;
  }
}

/** Rebuild team_season_stats for one league×season from match_stats. */
export async function recomputeTeamSeasonStats(
  leagueId: number,
  season: number
): Promise<{ teams: number }> {
  const rows = await listMatchStatsForLeagueSeason(leagueId, season);
  const byTeam = new Map<string, Acc>();

  for (const m of rows) {
    let home = byTeam.get(m.homeTeam);
    if (!home) {
      home = emptyAcc(m.homeTeam, m.homeId);
      byTeam.set(m.homeTeam, home);
    } else if (home.afTeamId == null && m.homeId != null) {
      home.afTeamId = m.homeId;
    }

    let away = byTeam.get(m.awayTeam);
    if (!away) {
      away = emptyAcc(m.awayTeam, m.awayId);
      byTeam.set(m.awayTeam, away);
    } else if (away.afTeamId == null && m.awayId != null) {
      away.afTeamId = m.awayId;
    }

    addSide(home, "home", {
      goals: m.homeGoals,
      against: m.awayGoals,
      xg: m.homeXg,
      xgAgainst: m.awayXg,
      shots: m.homeShots,
      shotsAgainst: m.awayShots,
      sot: m.homeShotsOnTarget,
      sotAgainst: m.awayShotsOnTarget,
      corners: m.homeCorners,
      cornersAgainst: m.awayCorners,
      possession: m.homePossession,
      fouls: m.homeFouls,
      yellow: m.homeYellowCards,
      red: m.homeRedCards,
      passes: m.homePasses,
      tackles: m.homeTackles,
    });

    addSide(away, "away", {
      goals: m.awayGoals,
      against: m.homeGoals,
      xg: m.awayXg,
      xgAgainst: m.homeXg,
      shots: m.awayShots,
      shotsAgainst: m.homeShots,
      sot: m.awayShotsOnTarget,
      sotAgainst: m.homeShotsOnTarget,
      corners: m.awayCorners,
      cornersAgainst: m.homeCorners,
      possession: m.awayPossession,
      fouls: m.awayFouls,
      yellow: m.awayYellowCards,
      red: m.awayRedCards,
      passes: m.awayPasses,
      tackles: m.awayTackles,
    });
  }

  const now = new Date();
  const out: NewTeamSeasonStats[] = [];
  for (const acc of byTeam.values()) {
    out.push({
      teamName: acc.teamName,
      leagueId,
      season,
      afTeamId: acc.afTeamId,
      matches: acc.matches,
      homeMatches: acc.homeMatches,
      awayMatches: acc.awayMatches,
      avgGoalsFor: avg(acc.goalsFor, acc.nGoals),
      avgGoalsAgainst: avg(acc.goalsAgainst, acc.nGoals),
      avgXgFor: avg(acc.xgFor, acc.nXg),
      avgXgAgainst: avg(acc.xgAgainst, acc.nXg),
      avgShotsFor: avg(acc.shotsFor, acc.nShots),
      avgShotsAgainst: avg(acc.shotsAgainst, acc.nShots),
      avgShotsOnTargetFor: avg(acc.sotFor, acc.nSot),
      avgShotsOnTargetAgainst: avg(acc.sotAgainst, acc.nSot),
      avgCornersFor: avg(acc.cornersFor, acc.nCorners),
      avgCornersAgainst: avg(acc.cornersAgainst, acc.nCorners),
      avgPossession: avg(acc.possession, acc.nPoss),
      avgFoulsFor: avg(acc.foulsFor, acc.nFouls),
      avgYellowCardsFor: avg(acc.yellowFor, acc.nYellow),
      avgRedCardsFor: avg(acc.redFor, acc.nRed),
      avgPassesFor: avg(acc.passesFor, acc.nPasses),
      avgTacklesFor: avg(acc.tacklesFor, acc.nTackles),
      homeAvgGoalsFor: avg(acc.homeGoalsFor, acc.nHomeGoals),
      homeAvgCornersFor: avg(acc.homeCornersFor, acc.nHomeCorners),
      homeAvgShotsOnTargetFor: avg(acc.homeSotFor, acc.nHomeSot),
      awayAvgGoalsFor: avg(acc.awayGoalsFor, acc.nAwayGoals),
      awayAvgCornersFor: avg(acc.awayCornersFor, acc.nAwayCorners),
      awayAvgShotsOnTargetFor: avg(acc.awaySotFor, acc.nAwaySot),
      updatedAt: now,
    });
  }

  const teams = await upsertTeamSeasonStatsRows(out);
  return { teams };
}
