/**
 * AI-enhanced matchup: reference seed Poisson + learner corrections when sample ≥ 10.
 * Non-blocking — always returns a prediction; mode indicates enhancement state.
 */
import {
  bttsFromMatrix,
  buildScoreMatrix,
  outcomeProbsFromMatrix,
  overUnderFromMatrix,
} from "@/lib/predictor/score-matrix";
import { analyzeCorrectScore } from "./correct-score";
import {
  getLeagueMatchupAnalysis,
  type LeagueMatchupAnalysis,
} from "./league-matchup-analysis";
import { STAT_ENGINE_CONFIG } from "./stat-engine-config";
import type { LearnerStatsStore } from "./types";

export const AI_ENHANCED_MIN_SAMPLES = 10;

export type PredictionMode = "reference" | "ai_enhanced";

export interface EnhancedMatchupPrediction extends Omit<LeagueMatchupAnalysis, "mode"> {
  mode: PredictionMode;
  learnerSamples: number;
  enhancementNote: string;
  corrections?: {
    homeLambdaFactor: number;
    awayLambdaFactor: number;
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function pct(p: number): number {
  return Math.round(p * 1000) / 10;
}

/**
 * Derive soft lambda corrections from personal learner odds-band history.
 * Conservative: max ±8% on lambdas.
 */
export function deriveLearnerCorrections(stats: LearnerStatsStore | null | undefined): {
  homeLambdaFactor: number;
  awayLambdaFactor: number;
} {
  if (!stats || stats.totalScoredPicks < AI_ENHANCED_MIN_SAMPLES) {
    return { homeLambdaFactor: 1, awayLambdaFactor: 1 };
  }

  const strong = stats.topReliableRanges;
  const weak = stats.weakestRanges;
  let homeLambdaFactor = 1;
  let awayLambdaFactor = 1;

  if (strong.includes("1.51-2.00") || strong.includes("1.00-1.50")) {
    homeLambdaFactor += 0.04;
  }
  if (weak.includes("2.51-3.00") || weak.includes("2.01-2.50")) {
    awayLambdaFactor -= 0.03;
  }

  const risky = stats.batchPatterns.find(
    (p) => p.label.includes("> 8") && p.totalBatches >= 3 && (p.winRate ?? 100) < 40
  );
  if (risky) {
    homeLambdaFactor -= 0.02;
    awayLambdaFactor -= 0.02;
  }

  return {
    homeLambdaFactor: clamp(homeLambdaFactor, 0.92, 1.08),
    awayLambdaFactor: clamp(awayLambdaFactor, 0.92, 1.08),
  };
}

function analysisFromLambdas(
  homeTeam: string,
  awayTeam: string,
  league: string,
  lambdaHome: number,
  lambdaAway: number,
  source: string
): LeagueMatchupAnalysis {
  const grid = buildScoreMatrix(
    lambdaHome,
    lambdaAway,
    STAT_ENGINE_CONFIG.DIXON_COLES_RHO,
    STAT_ENGINE_CONFIG.SCORE_GRID_MAX
  );
  const analysis = analyzeCorrectScore(grid);
  const outcomes = outcomeProbsFromMatrix(grid);
  const [over, under] = overUnderFromMatrix(grid, 2.5);
  const btts = bttsFromMatrix(grid);

  return {
    mode: "reference",
    homeTeam,
    awayTeam,
    league,
    lambdaHome,
    lambdaAway,
    source,
    expectedScore: `${Math.round(lambdaHome)}-${Math.round(lambdaAway)}`,
    mostLikelyScore: analysis
      ? `${analysis.mostLikely.home}-${analysis.mostLikely.away}`
      : `${Math.round(lambdaHome)}-${Math.round(lambdaAway)}`,
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

export function getEnhancedMatchupPrediction(
  homeTeam: string,
  awayTeam: string,
  league: string,
  learnerStats: LearnerStatsStore | null | undefined
): EnhancedMatchupPrediction | null {
  const base = getLeagueMatchupAnalysis(homeTeam, awayTeam, league);
  if (!base) return null;

  const samples = learnerStats?.totalScoredPicks ?? 0;
  if (samples < AI_ENHANCED_MIN_SAMPLES) {
    return {
      ...base,
      mode: "reference",
      learnerSamples: samples,
      enhancementNote: `Reference only — need ${AI_ENHANCED_MIN_SAMPLES} scored picks for AI enhancement (${samples} so far).`,
    };
  }

  const corrections = deriveLearnerCorrections(learnerStats);
  const lambdaHome = base.lambdaHome * corrections.homeLambdaFactor;
  const lambdaAway = base.lambdaAway * corrections.awayLambdaFactor;
  const adjusted = analysisFromLambdas(
    homeTeam,
    awayTeam,
    league,
    lambdaHome,
    lambdaAway,
    `${base.source} + learner corrections`
  );

  return {
    ...adjusted,
    mode: "ai_enhanced",
    learnerSamples: samples,
    enhancementNote: `AI enhanced from ${samples} scored picks (reference seed + personal corrections).`,
    corrections,
  };
}

export function learnerReadyForEnhancement(
  stats: LearnerStatsStore | null | undefined
): boolean {
  return (stats?.totalScoredPicks ?? 0) >= AI_ENHANCED_MIN_SAMPLES;
}
