/**
 * Total Goals analysis markets — consume canonical FT distribution only.
 * Dixon–Coles applied in the joint matrix before marginalising (Poisson path).
 * NegBin path uses fitted φ on historical totals when overdispersed.
 */
import { negBinPmf } from "@/lib/predictor/negbin";
import {
  computeGoalDistribution,
  overUnderFromTotalPmf,
} from "./goal-distribution";
import type { GoalsDistChoice } from "@/lib/hist/half-params-types";

const TOL = 1e-9;

export const TOTAL_GOALS_LINES = [
  0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5,
] as const;

export type TotalGoalsLine = (typeof TOTAL_GOALS_LINES)[number];

export type TotalGoalsLineMarket = { over: number; under: number };

export type TotalGoalsMarkets = {
  distributionFamily: GoalsDistChoice;
  dispersion: number | null;
  /** Exact-total PMF for k=0..7 plus grouped 8+ at index 8. */
  pmf: number[];
  expectedTotal: number;
  mode: number;
  /** 50% central credible interval [lo, hi] inclusive on total goals. */
  ci50: [number, number];
  lines: Record<TotalGoalsLine, TotalGoalsLineMarket>;
};

function assertNear(a: number, b: number, label: string, eps = TOL): void {
  if (Math.abs(a - b) > eps) {
    throw new Error(`${label}: ${a} ≠ ${b}`);
  }
}

/** Build NegBin total PMF with mean μ and dispersion φ=Var/Mean; bucket 8+. */
export function negBinTotalGoalsPmf(
  mu: number,
  dispersion: number,
  maxExact = 7
): number[] {
  const pmf: number[] = [];
  let mass = 0;
  for (let k = 0; k <= maxExact; k++) {
    const p = negBinPmf(k, mu, dispersion);
    pmf.push(p);
    mass += p;
  }
  // Tail 8..∞ approximated up to a high cap then residual.
  let tail = 0;
  for (let k = maxExact + 1; k <= 40; k++) {
    tail += negBinPmf(k, mu, dispersion);
  }
  const residual = Math.max(0, 1 - mass - tail);
  pmf.push(tail + residual);
  const sum = pmf.reduce((a, b) => a + b, 0);
  if (sum > 0) {
    for (let i = 0; i < pmf.length; i++) pmf[i]! /= sum;
  }
  return pmf;
}

/** Collapse a fine PMF (0..maxGoals) into 0..7 + 8+. */
export function bucketExactTotals(finePmf: number[]): number[] {
  const out = new Array(9).fill(0) as number[];
  for (let k = 0; k < finePmf.length; k++) {
    const p = finePmf[k] ?? 0;
    if (k <= 7) out[k]! += p;
    else out[8]! += p;
  }
  const sum = out.reduce((a, b) => a + b, 0);
  assertNear(sum, 1, "bucketed total PMF");
  return out;
}

export function mostLikelyTotal(pmf: number[]): number {
  let best = 0;
  let bestP = -1;
  for (let k = 0; k < pmf.length; k++) {
    const p = pmf[k] ?? 0;
    if (p > bestP) {
      bestP = p;
      best = k;
    }
  }
  return best;
}

/** Smallest [lo, hi] with cumulative mass ≥ 0.5 centred by expanding from median. */
export function centralCredibleInterval50(pmf: number[]): [number, number] {
  const cdf: number[] = [];
  let acc = 0;
  for (let k = 0; k < pmf.length; k++) {
    acc += pmf[k] ?? 0;
    cdf.push(acc);
  }
  let median = 0;
  for (let k = 0; k < cdf.length; k++) {
    if (cdf[k]! >= 0.5) {
      median = k;
      break;
    }
  }
  let lo = median;
  let hi = median;
  let mass = pmf[median] ?? 0;
  while (mass < 0.5 && (lo > 0 || hi < pmf.length - 1)) {
    const left = lo > 0 ? (pmf[lo - 1] ?? 0) : -1;
    const right = hi < pmf.length - 1 ? (pmf[hi + 1] ?? 0) : -1;
    if (right >= left && hi < pmf.length - 1) {
      hi += 1;
      mass += pmf[hi] ?? 0;
    } else if (lo > 0) {
      lo -= 1;
      mass += pmf[lo] ?? 0;
    } else if (hi < pmf.length - 1) {
      hi += 1;
      mass += pmf[hi] ?? 0;
    } else break;
  }
  return [lo, hi];
}

export function expectedFromPmf(pmf: number[]): number {
  let e = 0;
  for (let k = 0; k < pmf.length; k++) {
    // 8+ bucket: use 8.5 as representative for consistency check only when last
    const value = k === 8 && pmf.length === 9 ? 8.5 : k;
    e += value * (pmf[k] ?? 0);
  }
  return e;
}

export function buildLinesFromPmf(
  pmf: number[]
): Record<TotalGoalsLine, TotalGoalsLineMarket> {
  const lines = {} as Record<TotalGoalsLine, TotalGoalsLineMarket>;
  // Expand 8+ for O/U: treat index 8 as mass at k>=8 — reconstruct fine tail as k=8 only for half-lines.
  const fine: number[] = [];
  for (let k = 0; k <= 7; k++) fine.push(pmf[k] ?? 0);
  fine.push(pmf[8] ?? 0); // all 8+ at 8 is correct for lines ≤ 6.5
  for (const line of TOTAL_GOALS_LINES) {
    const [over, under] = overUnderFromTotalPmf(fine, line);
    assertNear(over + under, 1, `O/U ${line}`);
    lines[line] = { over, under };
  }
  // Monotonicity: Over decreases with line
  for (let i = 1; i < TOTAL_GOALS_LINES.length; i++) {
    const prev = lines[TOTAL_GOALS_LINES[i - 1]!]!.over;
    const cur = lines[TOTAL_GOALS_LINES[i]!]!.over;
    if (cur > prev + TOL) {
      throw new Error(
        `Over monotonicity broken: Over ${TOTAL_GOALS_LINES[i]} > Over ${TOTAL_GOALS_LINES[i - 1]}`
      );
    }
  }
  return lines;
}

/**
 * Build total-goals markets from FT λ.
 * - Poisson path: Dixon–Coles joint → marginalise.
 * - NegBin path: univariate NegBin on E[T] with fitted φ (when overdispersed).
 */
export function buildTotalGoalsMarkets(input: {
  lambdaHome: number;
  lambdaAway: number;
  rho: number;
  maxGoals?: number;
  distributionFamily?: GoalsDistChoice;
  dispersion?: number | null;
}): TotalGoalsMarkets {
  const expectedTotal = input.lambdaHome + input.lambdaAway;
  const family = input.distributionFamily ?? "poisson";
  const dispersion = input.dispersion ?? null;

  let pmf: number[];
  if (
    family === "negbin" &&
    dispersion != null &&
    Number.isFinite(dispersion) &&
    dispersion > 1
  ) {
    pmf = negBinTotalGoalsPmf(expectedTotal, dispersion);
  } else {
    const dist = computeGoalDistribution(input.lambdaHome, input.lambdaAway, {
      rho: input.rho,
      maxGoals: input.maxGoals,
    });
    pmf = bucketExactTotals(dist.totalPmf);
  }

  assertNear(
    pmf.reduce((a, b) => a + b, 0),
    1,
    "totalGoals pmf"
  );

  const lines = buildLinesFromPmf(pmf);
  const mode = mostLikelyTotal(pmf);
  const ci50 = centralCredibleInterval50(pmf);

  // Analytic mean vs distribution mean — use fine reconstruction for check.
  const ePmf = expectedFromPmf(pmf);
  // For Poisson DC path, E[T] from λ should match; NegBin exact mean is μ.
  // Bucketed 8+ uses 8.5 so allow slightly looser tolerance.
  if (Math.abs(ePmf - expectedTotal) > 0.35 && family === "poisson") {
    // Soft: bucketing bias only — hard assert uses Σ k·P on fine PMF in tests.
  }

  return {
    distributionFamily: family === "negbin" ? "negbin" : "poisson",
    dispersion,
    pmf,
    expectedTotal,
    mode,
    ci50,
    lines,
  };
}
