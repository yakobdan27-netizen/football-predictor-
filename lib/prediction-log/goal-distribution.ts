/**
 * Coherent goal / count distributions.
 * Over/Under and BTTS Yes/No are always derived slices of one PMF
 * (under = 1 − over). Never blend probability outputs independently.
 */
import { overUnderFromPmf, sumMatrix } from "@/lib/predictor/poisson";
import {
  awayGoalsPmf,
  bttsFromMatrix,
  buildScoreMatrix,
  homeGoalsPmf,
  outcomeProbsFromMatrix,
  overUnderFromMatrix,
  totalGoalsPmf,
} from "@/lib/predictor/score-matrix";
import { standardizeTeamName } from "@/lib/data/team-names";
import { STAT_ENGINE_CONFIG } from "./stat-engine-config";
import { poissonOverLine } from "./poisson-ou";

const TOL = 1e-9;

export type GoalDistribution = {
  matrix: number[][];
  totalPmf: number[];
  homePmf: number[];
  awayPmf: number[];
};

function assertNearOne(sum: number, label: string): void {
  if (Math.abs(sum - 1) > TOL) {
    throw new Error(`${label} not normalized: sum=${sum}`);
  }
}

export function computeGoalDistribution(
  lambdaHome: number,
  lambdaAway: number,
  opts?: { rho?: number; maxGoals?: number }
): GoalDistribution {
  const rho = opts?.rho ?? STAT_ENGINE_CONFIG.DIXON_COLES_RHO;
  const maxGoals = opts?.maxGoals ?? STAT_ENGINE_CONFIG.SCORE_GRID_MAX;
  const matrix = buildScoreMatrix(lambdaHome, lambdaAway, rho, maxGoals);
  assertNearOne(sumMatrix(matrix), "score matrix");
  const totalPmf = totalGoalsPmf(matrix);
  const homePmf = homeGoalsPmf(matrix);
  const awayPmf = awayGoalsPmf(matrix);
  assertNearOne(
    totalPmf.reduce((a, b) => a + b, 0),
    "total goals PMF"
  );
  assertNearOne(
    homePmf.reduce((a, b) => a + b, 0),
    "home goals PMF"
  );
  assertNearOne(
    awayPmf.reduce((a, b) => a + b, 0),
    "away goals PMF"
  );
  return { matrix, totalPmf, homePmf, awayPmf };
}

/** Returns [P_over, P_under] guaranteed to sum to 1. */
export function overUnderFromTotalPmf(
  pmf: number[],
  line: number
): [number, number] {
  const [over, under] = overUnderFromPmf(pmf, line);
  assertNearOne(over + under, `O/U line ${line}`);
  return [over, under];
}

export function overUnderFromGoalMatrix(
  matrix: number[][],
  line: number
): [number, number] {
  const [over, under] = overUnderFromMatrix(matrix, line);
  assertNearOne(over + under, `matrix O/U line ${line}`);
  return [over, under];
}

/** Returns [P_yes, P_no] guaranteed to sum to 1. */
export function bttsYesNo(matrix: number[][]): [number, number] {
  const { yes, no } = bttsFromMatrix(matrix);
  assertNearOne(yes + no, "BTTS");
  return [yes, no];
}

/** Univariate Poisson O/U (corners, per-team HT). Half-lines: O+U=1. */
export function overUnderFromLambda(
  lambda: number,
  line: number
): [number, number] {
  const over = poissonOverLine(line, lambda);
  const under = 1 - over;
  assertNearOne(over + under, `univariate O/U line ${line}`);
  return [over, under];
}

/**
 * Whole-number lines: explicit push mass.
 * P(over)+P(under)+P(push)=1.
 */
export function overUnderPushFromPmf(
  pmf: number[],
  line: number
): { over: number; under: number; push: number } {
  const isWhole = Number.isInteger(line);
  let over = 0;
  let under = 0;
  let push = 0;
  for (let k = 0; k < pmf.length; k++) {
    const p = pmf[k] ?? 0;
    if (isWhole && k === line) push += p;
    else if (k > line) over += p;
    else under += p;
  }
  const total = over + under + push;
  if (total <= 0) return { over: 0, under: 1, push: 0 };
  const out = {
    over: over / total,
    under: under / total,
    push: push / total,
  };
  assertNearOne(out.over + out.under + out.push, `O/U/P line ${line}`);
  return out;
}

function isOverPrediction(prediction: string): boolean {
  return /\bover\b/i.test(prediction);
}

function isYesPrediction(prediction: string): boolean {
  return /\byes\b/i.test(prediction);
}

/**
 * Event probability (0–100) for a binary market side from one score grid.
 * Returns null when the market is not a goals binary or grid is missing.
 */
export function eventProbPctFromScoreGrid(
  marketKey: string,
  prediction: string,
  line: number | undefined,
  grid: number[][],
  homeTeam?: string,
  awayTeam?: string
): number | null {
  const key = marketKey.toLowerCase();
  if (key === "total_goals_ou") {
    const [over, under] = overUnderFromGoalMatrix(grid, line ?? 2.5);
    return (isOverPrediction(prediction) ? over : under) * 100;
  }
  if (key === "home_goals_ou") {
    const [over, under] = overUnderFromTotalPmf(homeGoalsPmf(grid), line ?? 1.5);
    return (isOverPrediction(prediction) ? over : under) * 100;
  }
  if (key === "away_goals_ou") {
    const [over, under] = overUnderFromTotalPmf(awayGoalsPmf(grid), line ?? 1.5);
    return (isOverPrediction(prediction) ? over : under) * 100;
  }
  if (key === "btts") {
    const [yes, no] = bttsYesNo(grid);
    return (isYesPrediction(prediction) ? yes : no) * 100;
  }
  if (key === "1x2" || key === "ht_1x2") {
    const outcomes = outcomeProbsFromMatrix(grid);
    const p = prediction.trim().toLowerCase().replace(/\s+/g, " ");
    if (p === "draw" || p === "x" || p === "tie") return outcomes.draw * 100;
    if (p === "home" || p === "1" || p === "home win") return outcomes.home * 100;
    if (p === "away" || p === "2" || p === "away win") return outcomes.away * 100;
    if (homeTeam && standardizeTeamName(prediction).toLowerCase() === standardizeTeamName(homeTeam).toLowerCase()) {
      return outcomes.home * 100;
    }
    if (awayTeam && standardizeTeamName(prediction).toLowerCase() === standardizeTeamName(awayTeam).toLowerCase()) {
      return outcomes.away * 100;
    }
    return null;
  }
  return null;
}
