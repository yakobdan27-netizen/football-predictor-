/**
 * In-memory BETA_2H cache (no DB — safe for client bundles).
 */
const DEFAULT_BETA = 1.15;

let cachedBetas: Record<string, number> | null = null;

export function setBeta2hCache(betas: Record<string, number>): void {
  cachedBetas = { ...betas };
}

export function beta2hFor(league: string): number {
  const v = cachedBetas?.[league];
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return DEFAULT_BETA;
}

export { DEFAULT_BETA as FALLBACK_BETA_2H };
