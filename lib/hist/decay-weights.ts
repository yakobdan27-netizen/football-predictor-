/**
 * Season decay weights: w_raw = 0.8^seasons_ago, then normalize to Σw = 1.
 */
import { HIST_SEASON_DECAY_BASE, histSeasonWeight } from "./seasons";

export type WeightedSeason = { season: number; wRaw: number; w: number };

/** Normalize raw weights so Σw == 1 within 1e-9. */
export function normalizeWeights(raw: number[]): number[] {
  const sum = raw.reduce((a, b) => a + b, 0);
  if (!(sum > 0) || !Number.isFinite(sum)) {
    const n = raw.length;
    return n > 0 ? raw.map(() => 1 / n) : [];
  }
  const out = raw.map((w) => w / sum);
  const check = out.reduce((a, b) => a + b, 0);
  if (Math.abs(check - 1) > 1e-9) {
    throw new Error(`normalizeWeights: sum=${check} (expected 1)`);
  }
  return out;
}

/** Build normalized season weights for a set of season start years. */
export function normalizedSeasonWeights(
  seasons: number[],
  current: number
): WeightedSeason[] {
  const wRaw = seasons.map((s) => histSeasonWeight(s, current));
  const w = normalizeWeights(wRaw);
  return seasons.map((season, i) => ({
    season,
    wRaw: wRaw[i]!,
    w: w[i]!,
  }));
}

/** Effective sample size after weighting: ESS = (Σw)² / Σ(w²). */
export function effectiveSampleSize(weights: number[]): number {
  const sum = weights.reduce((a, b) => a + b, 0);
  const sumSq = weights.reduce((a, b) => a + b * b, 0);
  if (!(sumSq > 0)) return 0;
  return (sum * sum) / sumSq;
}

/** Weighted mean of values with optional pre-normalized weights. */
export function weightedMean(
  values: number[],
  weights: number[],
  opts?: { alreadyNormalized?: boolean }
): number {
  if (values.length === 0 || values.length !== weights.length) return NaN;
  const w = opts?.alreadyNormalized ? weights : normalizeWeights(weights);
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i]! * w[i]!;
  return s;
}

export { HIST_SEASON_DECAY_BASE, histSeasonWeight };
