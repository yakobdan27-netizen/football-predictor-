/**
 * Reference-only matchup analysis from 2021–26 seed priors (Poisson / Dixon-Coles grid).
 */
import {
  bttsFromMatrix,
  buildScoreMatrix,
  outcomeProbsFromMatrix,
  overUnderFromMatrix,
} from "@/lib/predictor/score-matrix";
import { analyzeCorrectScore } from "./correct-score";
import { seedCorrectScoreLambdas } from "./correct-score-seed";
import { STAT_ENGINE_CONFIG } from "./stat-engine-config";

export interface LeagueMatchupAnalysis {
  mode: "reference";
  homeTeam: string;
  awayTeam: string;
  league: string;
  lambdaHome: number;
  lambdaAway: number;
  source: string;
  expectedScore: string;
  mostLikelyScore: string;
  mostLikelyProbPct: number;
  winProbability: { home: number; draw: number; away: number };
  overUnder25: { over: number; under: number };
  bothTeamsToScore: { yes: number; no: number };
}

function pct(p: number): number {
  return Math.round(p * 1000) / 10;
}

export function getLeagueMatchupAnalysis(
  homeTeam: string,
  awayTeam: string,
  league: string
): LeagueMatchupAnalysis | null {
  const seeded = seedCorrectScoreLambdas(homeTeam, awayTeam, league);
  if (!seeded) return null;

  const grid = buildScoreMatrix(
    seeded.lambdaHome,
    seeded.lambdaAway,
    STAT_ENGINE_CONFIG.DIXON_COLES_RHO,
    STAT_ENGINE_CONFIG.SCORE_GRID_MAX
  );
  const analysis = analyzeCorrectScore(grid);
  const outcomes = outcomeProbsFromMatrix(grid);
  const [over, under] = overUnderFromMatrix(grid, 2.5);
  const btts = bttsFromMatrix(grid);

  const expectedHome = Math.round(seeded.lambdaHome);
  const expectedAway = Math.round(seeded.lambdaAway);

  return {
    mode: "reference",
    homeTeam,
    awayTeam,
    league,
    lambdaHome: seeded.lambdaHome,
    lambdaAway: seeded.lambdaAway,
    source: seeded.source,
    expectedScore: `${expectedHome}-${expectedAway}`,
    mostLikelyScore: analysis
      ? `${analysis.mostLikely.home}-${analysis.mostLikely.away}`
      : `${expectedHome}-${expectedAway}`,
    mostLikelyProbPct: analysis?.mostLikely.probPct ?? 0,
    winProbability: {
      home: pct(outcomes.home),
      draw: pct(outcomes.draw),
      away: pct(outcomes.away),
    },
    overUnder25: { over: pct(over), under: pct(under) },
    bothTeamsToScore: { yes: pct(btts.yes), no: pct(btts.no) },
  };
}
