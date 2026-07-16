import {
  buildScoreMatrix,
  jointProbFromGrid,
} from "@/lib/predictor/score-matrix";
import { STAT_ENGINE_CONFIG } from "./stat-engine-config";

/** Goal difference (home − away). Line is always applied to the home side. */
export function goalDifference(homeGoals: number, awayGoals: number): number {
  return homeGoals - awayGoals;
}

/** Asian handicap outcome from stored goal difference and home line. */
export function asianHandicapResult(
  goalDiff: number,
  line: number
): "home" | "away" | "push" {
  const v = goalDiff + line;
  if (v > 0) return "home";
  if (v < 0) return "away";
  return "push";
}

/** European (3-way) handicap outcome from stored goal difference and home line. */
export function europeanHandicapResult(
  goalDiff: number,
  line: number
): "home" | "draw" | "away" {
  const v = goalDiff + line;
  if (v > 0) return "home";
  if (v === 0) return "draw";
  return "away";
}

export function asianHandicapProb(
  grid: number[][],
  line: number,
  side: "home" | "away"
): number {
  return jointProbFromGrid(grid, (h, a) => {
    const v = h - a + line;
    return side === "home" ? v > 0 : v < 0;
  });
}

export function europeanHandicapProb(
  grid: number[][],
  line: number,
  side: "home" | "draw" | "away"
): number {
  return jointProbFromGrid(grid, (h, a) => {
    const v = h - a + line;
    if (side === "home") return v > 0;
    if (side === "draw") return v === 0;
    return v < 0;
  });
}

const HT_TIME_FACTOR = 0.45;
const DIXON_COLES_RHO = -0.13;

/** Half-time score grid from full-time lambdas (same split as combo markets). */
export function halfTimeScoreGrid(
  lambdaHome: number,
  lambdaAway: number
): number[][] {
  const maxGoals = STAT_ENGINE_CONFIG.SCORE_GRID_MAX;
  return buildScoreMatrix(
    lambdaHome * HT_TIME_FACTOR,
    lambdaAway * HT_TIME_FACTOR,
    DIXON_COLES_RHO,
    maxGoals
  );
}

export function formatHandicapLine(line: number): string {
  return line > 0 ? `+${line}` : String(line);
}
