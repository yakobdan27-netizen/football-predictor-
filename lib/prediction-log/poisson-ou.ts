/**
 * Shared Poisson over/under helpers used by corners totals and per-team lines.
 * Behavior must stay identical to the former inline helpers in corners-model.ts.
 */
import { poissonPmf } from "@/lib/predictor/poisson";

const POISSON_GRID_MAX = 25;

export function poissonCdfAtOrBelow(k: number, lambda: number): number {
  let sum = 0;
  const max = Math.min(POISSON_GRID_MAX, Math.max(0, Math.floor(k)));
  for (let i = 0; i <= max; i++) sum += poissonPmf(i, Math.max(0, lambda));
  // Tail mass for k >= grid is negligible for typical corner lambdas
  return Math.min(1, Math.max(0, sum));
}

/** Over n.5 → P(X >= n+1) = 1 - P(X <= n) */
export function poissonOverLine(line: number, lambda: number): number {
  const threshold = Math.floor(line);
  return 1 - poissonCdfAtOrBelow(threshold, lambda);
}
