import type { CanonicalProposition } from "../types";

export function scoreOps(prop: CanonicalProposition): number {
  const p = prop.calibratedProbability;
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(100, 100 * p));
}
