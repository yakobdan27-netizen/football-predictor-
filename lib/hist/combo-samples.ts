/**
 * Weighted hist samples for Combined Odds (11-season window).
 * Prefer these before API fallback when club samples are thin.
 * Server-only (Neon). Never writes prediction-log / live_ / bet_.
 */
import { and, eq, gte, isNotNull, or, sql } from "drizzle-orm";
import { standardizeTeamName } from "@/lib/data/team-names";
import { getDb } from "@/lib/db";
import { histFixtures } from "@/lib/db/schema";
import { apiLeagueId } from "@/lib/football-api/leagues";
import { buildScoreMatrix } from "@/lib/predictor/score-matrix";
import {
  computeTeamHalfFromHist,
  leagueGoalAverageFromHist,
} from "./team-half-intensities";
import {
  currentHistSeason,
  histSeasonWeight,
  histWindowMinSeason,
} from "./seasons";

const MIN_WEIGHTED_N = 8;
const MIN_H2H_WEIGHTED = 3;

export type HistLeagueMarketBases = {
  league: string;
  leagueId: number;
  n: number;
  weightedN: number;
  goalsPerGame: number;
  homeWinRate: number;
  drawRate: number;
  awayWinRate: number;
  over25Rate: number;
  bttsRate: number;
  source: "hist";
};

export type HistH2HSample = {
  homeTeam: string;
  awayTeam: string;
  league: string;
  n: number;
  weightedN: number;
  homeWinRate: number;
  drawRate: number;
  awayWinRate: number;
  over25Rate: number;
  bttsRate: number;
  avgGoals: number;
  source: "hist";
};

export type HistScoreGridResult = {
  scoreGrid: number[][];
  lambdaHome: number;
  lambdaAway: number;
  weightedN: number;
  source: "hist";
};

function teamKey(name: string): string {
  return standardizeTeamName(name).trim().toLowerCase();
}

/** League FT market bases over the 11-season weighted window. */
export async function leagueMarketBasesFromHist(
  league: string
): Promise<HistLeagueMarketBases | null> {
  const leagueId = apiLeagueId(league);
  if (leagueId == null) return null;
  const db = await getDb();
  const current = currentHistSeason();
  const minSeason = histWindowMinSeason();
  const rows = await db
    .select({
      season: histFixtures.season,
      ftHome: histFixtures.ftHome,
      ftAway: histFixtures.ftAway,
    })
    .from(histFixtures)
    .where(
      and(
        eq(histFixtures.leagueId, leagueId),
        isNotNull(histFixtures.ftHome),
        isNotNull(histFixtures.ftAway),
        gte(histFixtures.season, minSeason)
      )
    );

  if (rows.length < MIN_WEIGHTED_N) return null;

  let wSum = 0;
  let gSum = 0;
  let homeW = 0;
  let drawW = 0;
  let awayW = 0;
  let overW = 0;
  let bttsW = 0;
  for (const r of rows) {
    const w = histSeasonWeight(r.season, current);
    const fh = r.ftHome!;
    const fa = r.ftAway!;
    const total = fh + fa;
    wSum += w;
    gSum += total * w;
    if (fh > fa) homeW += w;
    else if (fh === fa) drawW += w;
    else awayW += w;
    if (total > 2.5) overW += w;
    if (fh > 0 && fa > 0) bttsW += w;
  }
  if (wSum < MIN_WEIGHTED_N) return null;

  return {
    league,
    leagueId,
    n: rows.length,
    weightedN: wSum,
    goalsPerGame: gSum / wSum,
    homeWinRate: homeW / wSum,
    drawRate: drawW / wSum,
    awayWinRate: awayW / wSum,
    over25Rate: overW / wSum,
    bttsRate: bttsW / wSum,
    source: "hist",
  };
}

/** Weighted H2H between two teams in a league (name-matched). */
export async function h2hFromHist(
  homeTeam: string,
  awayTeam: string,
  league: string
): Promise<HistH2HSample | null> {
  const leagueId = apiLeagueId(league);
  if (leagueId == null) return null;
  const home = standardizeTeamName(homeTeam);
  const away = standardizeTeamName(awayTeam);
  const hk = teamKey(home);
  const ak = teamKey(away);
  if (!hk || !ak || hk === ak) return null;

  const db = await getDb();
  const current = currentHistSeason();
  const minSeason = histWindowMinSeason();
  const rows = await db
    .select({
      season: histFixtures.season,
      homeTeam: histFixtures.homeTeam,
      awayTeam: histFixtures.awayTeam,
      ftHome: histFixtures.ftHome,
      ftAway: histFixtures.ftAway,
    })
    .from(histFixtures)
    .where(
      and(
        eq(histFixtures.leagueId, leagueId),
        isNotNull(histFixtures.ftHome),
        isNotNull(histFixtures.ftAway),
        gte(histFixtures.season, minSeason),
        or(
          and(
            sql`lower(${histFixtures.homeTeam}) = ${hk}`,
            sql`lower(${histFixtures.awayTeam}) = ${ak}`
          ),
          and(
            sql`lower(${histFixtures.homeTeam}) = ${ak}`,
            sql`lower(${histFixtures.awayTeam}) = ${hk}`
          )
        )
      )
    );

  if (rows.length === 0) return null;

  let wSum = 0;
  let homeW = 0;
  let drawW = 0;
  let awayW = 0;
  let overW = 0;
  let bttsW = 0;
  let gSum = 0;
  for (const r of rows) {
    const w = histSeasonWeight(r.season, current);
    const sameOrientation = teamKey(r.homeTeam) === hk;
    const fh = sameOrientation ? r.ftHome! : r.ftAway!;
    const fa = sameOrientation ? r.ftAway! : r.ftHome!;
    const total = fh + fa;
    wSum += w;
    gSum += total * w;
    if (fh > fa) homeW += w;
    else if (fh === fa) drawW += w;
    else awayW += w;
    if (total > 2.5) overW += w;
    if (fh > 0 && fa > 0) bttsW += w;
  }
  if (wSum < MIN_H2H_WEIGHTED) return null;

  return {
    homeTeam: home,
    awayTeam: away,
    league,
    n: rows.length,
    weightedN: wSum,
    homeWinRate: homeW / wSum,
    drawRate: drawW / wSum,
    awayWinRate: awayW / wSum,
    over25Rate: overW / wSum,
    bttsRate: bttsW / wSum,
    avgGoals: gSum / wSum,
    source: "hist",
  };
}

/**
 * Build a Poisson score grid from hist team half intensities + league average.
 * Used when clubRecords sample is thin — before any API fallback.
 */
export async function scoreGridFromHist(
  homeTeam: string,
  awayTeam: string,
  league: string
): Promise<HistScoreGridResult | null> {
  const [homeProf, awayProf, leagueAvg] = await Promise.all([
    computeTeamHalfFromHist(homeTeam, "home", league),
    computeTeamHalfFromHist(awayTeam, "away", league),
    leagueGoalAverageFromHist(league),
  ]);

  if (!homeProf || !awayProf) return null;
  const n = Math.min(homeProf.n_matches, awayProf.n_matches);
  if (n < MIN_WEIGHTED_N) return null;

  const homeFor = homeProf.sc_1h + homeProf.sc_2h;
  const homeAgainst = homeProf.conc_1h + homeProf.conc_2h;
  const awayFor = awayProf.sc_1h + awayProf.sc_2h;
  const awayAgainst = awayProf.conc_1h + awayProf.conc_2h;
  const gpg = leagueAvg ?? (homeFor + awayFor + homeAgainst + awayAgainst) / 2;
  const half = Math.max(0.4, gpg / 2);

  const lambdaHome = Math.max(
    0.2,
    0.5 * (homeFor + awayAgainst) * (half / Math.max(0.3, (homeFor + homeAgainst) / 2))
  );
  const lambdaAway = Math.max(
    0.2,
    0.5 * (awayFor + homeAgainst) * (half / Math.max(0.3, (awayFor + awayAgainst) / 2))
  );

  // Mild Dixon-Coles rho; hist-only path keeps it near zero.
  const scoreGrid = buildScoreMatrix(lambdaHome, lambdaAway, -0.05, 8);
  return {
    scoreGrid,
    lambdaHome,
    lambdaAway,
    weightedN: n,
    source: "hist",
  };
}

export type ComboHistGridRequest = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
};

export type ComboHistGridResponse = {
  grids: Record<string, number[][]>;
  sources: Record<string, "hist">;
  leagueBases: Record<string, HistLeagueMarketBases>;
  insufficient: string[];
};

/** Batch score grids for matches that lack club-sample grids. */
export async function comboHistGridsForMatches(
  requests: ComboHistGridRequest[]
): Promise<ComboHistGridResponse> {
  const grids: Record<string, number[][]> = {};
  const sources: Record<string, "hist"> = {};
  const leagueBases: Record<string, HistLeagueMarketBases> = {};
  const insufficient: string[] = [];
  const leaguesNeeded = new Set(requests.map((r) => r.league));

  await Promise.all(
    [...leaguesNeeded].map(async (league) => {
      const bases = await leagueMarketBasesFromHist(league);
      if (bases) leagueBases[league] = bases;
    })
  );

  for (const req of requests) {
    try {
      const built = await scoreGridFromHist(
        req.homeTeam,
        req.awayTeam,
        req.league
      );
      if (built) {
        grids[req.matchId] = built.scoreGrid;
        sources[req.matchId] = "hist";
      } else {
        insufficient.push(req.matchId);
      }
    } catch {
      insufficient.push(req.matchId);
    }
  }

  return { grids, sources, leagueBases, insufficient };
}
