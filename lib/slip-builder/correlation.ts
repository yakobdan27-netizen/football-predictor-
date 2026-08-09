/**
 * Within-slip correlation control and honest slip probability bands.
 *
 * Independence estimate (upper) = ∏ p_i
 * Lower bound shrinks the product using mean residual pairwise ρ.
 */
import type { CandidateLeg } from "./types";

export type LegOutcomeKey = string;

export function legOutcomeKey(leg: Pick<CandidateLeg, "family" | "selectionKey">): LegOutcomeKey {
  return `${leg.family}::${leg.selectionKey}`;
}

/** Pearson correlation of two 0/1 series. Returns 0 if undefined. */
export function pearsonRho(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 8) return 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i]!;
    sumB += b[i]!;
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  if (den < 1e-12) return 0;
  const r = num / den;
  return Math.max(-1, Math.min(1, r));
}

/**
 * Family-proximity heuristic when hist co-occurrence is unavailable.
 * Same family → higher base ρ; same conflict group → moderate; else low.
 */
export function heuristicRho(a: CandidateLeg, b: CandidateLeg): number {
  if (a.fixtureId === b.fixtureId) return 0.95;
  if (a.family === b.family) {
    if (a.competition === b.competition) return 0.28;
    return 0.18;
  }
  if (a.competition === b.competition) return 0.12;
  return 0.05;
}

export type RhoLookup = (a: CandidateLeg, b: CandidateLeg) => number;

export function pairwiseRhoMatrix(
  legs: CandidateLeg[],
  lookup: RhoLookup
): number[][] {
  const n = legs.length;
  const m: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = lookup(legs[i]!, legs[j]!);
      m[i]![j] = r;
      m[j]![i] = r;
    }
  }
  return m;
}

export function meanPairwiseRho(matrix: number[][]): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = i + 1; j < matrix.length; j++) {
      sum += matrix[i]![j]!;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

export function maxPairwiseRho(matrix: number[][]): number {
  let max = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = i + 1; j < matrix.length; j++) {
      max = Math.max(max, matrix[i]![j]!);
    }
  }
  return max;
}

/**
 * Slip band:
 * - upper = product of p_i (independence — labelled upper bound)
 * - lower = upper × (1 − meanρ × (1 − 1/k)) clipped to [0, upper]
 */
export function slipBand(
  probs: number[],
  meanRho: number
): { independenceUpper: number; bandLower: number; bandUpper: number } {
  const k = probs.length;
  if (k === 0) {
    return { independenceUpper: 0, bandLower: 0, bandUpper: 0 };
  }
  let upper = 1;
  for (const p of probs) upper *= Math.max(0, Math.min(1, p));
  const shrink = Math.max(0, Math.min(1, meanRho)) * (1 - 1 / Math.max(1, k));
  const lower = upper * (1 - shrink);
  return {
    independenceUpper: upper,
    bandLower: Math.min(lower, upper),
    bandUpper: upper,
  };
}

/** True if any pair exceeds ceiling. */
export function exceedsCorrelationCeiling(
  matrix: number[][],
  ceiling: number
): boolean {
  return maxPairwiseRho(matrix) > ceiling + 1e-12;
}

/**
 * Find indices of the worst violating pair (highest ρ among pairs > ceiling).
 * Returns the lower-scoring index to replace, and the partner index.
 */
export function worstViolation(
  legs: CandidateLeg[],
  matrix: number[][],
  ceiling: number
): { replaceIndex: number; partnerIndex: number; rho: number } | null {
  let best: { replaceIndex: number; partnerIndex: number; rho: number } | null =
    null;
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const rho = matrix[i]![j]!;
      if (rho <= ceiling) continue;
      const replaceIndex =
        legs[i]!.pCalibrated <= legs[j]!.pCalibrated ? i : j;
      const partnerIndex = replaceIndex === i ? j : i;
      if (!best || rho > best.rho) {
        best = { replaceIndex, partnerIndex, rho };
      }
    }
  }
  return best;
}
