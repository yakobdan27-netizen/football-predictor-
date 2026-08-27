import {
  buildScoreMatrix,
  jointProbFromGrid,
} from "@/lib/predictor/score-matrix";
import { STAT_ENGINE_CONFIG } from "./stat-engine-config";

/** Standard Asian handicap lines (home-signed). */
export const DEFAULT_HANDICAP_LINES = [
  -2.5, -1.5, -0.5, 0, 0.5, 1.5, 2.5,
] as const;

/** Goal difference (home − away). Line is always applied to the home side. */
export function goalDifference(homeGoals: number, awayGoals: number): number {
  return homeGoals - awayGoals;
}

/** Adjusted margin after applying the home line: positive favours home cover. */
export function handicapAdjustedDiff(goalDiff: number, line: number): number {
  return goalDiff + line;
}

/** Home line role: negative = home gives goals; positive = home receives. */
export function handicapLineRole(line: number): "giving" | "receiving" | "pickem" {
  if (line === 0) return "pickem";
  return line < 0 ? "giving" : "receiving";
}

/**
 * Canonical signed home line matching expected goal difference.
 * Favourites get negative lines; underdogs get positive lines.
 */
export function canonicalHomeHandicapLine(expectedDiff: number): number {
  if (expectedDiff >= 1.25) return -1.5;
  if (expectedDiff >= 0.75) return -0.5;
  if (expectedDiff <= -1.25) return 1.5;
  if (expectedDiff <= -0.75) return 0.5;
  return 0;
}

/**
 * Filter handicap lines to those directionally valid for the expected favourite.
 * Home favourite → non-positive lines; home underdog → non-negative lines.
 */
export function directionallyValidHomeLines(
  expectedDiff: number,
  lines: readonly number[] = DEFAULT_HANDICAP_LINES
): number[] {
  const threshold = 0.25;
  if (expectedDiff >= threshold) {
    return lines.filter((l) => l <= 0);
  }
  if (expectedDiff <= -threshold) {
    return lines.filter((l) => l >= 0);
  }
  return [...lines];
}

/** Asian handicap outcome from stored goal difference and home line. */
export function asianHandicapResult(
  goalDiff: number,
  line: number
): "home" | "away" | "push" {
  const v = handicapAdjustedDiff(goalDiff, line);
  if (v > 0) return "home";
  if (v < 0) return "away";
  return "push";
}

/** European (3-way) handicap outcome from stored goal difference and home line. */
export function europeanHandicapResult(
  goalDiff: number,
  line: number
): "home" | "draw" | "away" {
  const v = handicapAdjustedDiff(goalDiff, line);
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

export function formatHandicapLine(
  line: number,
  opts?: { showRole?: boolean }
): string {
  const base = line > 0 ? `+${line}` : String(line);
  if (!opts?.showRole) return base;
  const role = handicapLineRole(line);
  if (role === "pickem") return `${base} (pick'em)`;
  return `${base} (${role})`;
}
