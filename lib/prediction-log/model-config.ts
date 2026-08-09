/**
 * Shared model hyperparameters for the canonical fixture estimate path.
 * Tunables live here — not scattered as magic numbers.
 */

/** Shrinkage constant toward league mean (brief §2.3). */
export const SHRINKAGE_K = 10;

/** Lambda sanity band — clamp + warn outside. */
export const LAMBDA_MIN = 0.15;
export const LAMBDA_MAX = 5.0;

/** Score matrix goal cap (0..MAX inclusive) + tail mass bucket. */
export const SCORE_MATRIX_MAX_GOALS = 9;

/** Half intensity sum vs FT tolerance. */
export const HALF_SUM_FT_TOLERANCE = 0.02;

/** Corner dispersion threshold for Negative Binomial. */
export const CORNER_DISPERSION_NB_THRESHOLD = 1.15;

/** Model params version bump when fitting ρ / dispersion changes. */
export const MODEL_PARAMS_VERSION = "v1-audit-2026-08";

export function clampLambda(lambda: number, label = "λ"): number {
  if (!Number.isFinite(lambda)) {
    console.warn(`[model-config] ${label} non-finite; using ${LAMBDA_MIN}`);
    return LAMBDA_MIN;
  }
  if (lambda < LAMBDA_MIN || lambda > LAMBDA_MAX) {
    console.warn(
      `[model-config] ${label}=${lambda} outside [${LAMBDA_MIN},${LAMBDA_MAX}]; clamping`
    );
    return Math.min(LAMBDA_MAX, Math.max(LAMBDA_MIN, lambda));
  }
  return lambda;
}

/**
 * Empirical Bayes shrink of a team rate toward league mean.
 * λ = (n_eff × rate + k × μ) / (n_eff + k)
 */
export function shrinkRateTowardLeague(
  rate: number,
  nEff: number,
  muLeague: number,
  k: number = SHRINKAGE_K
): number {
  const n = Math.max(0, nEff);
  const kk = Math.max(0, k);
  if (n + kk <= 0) return muLeague;
  return (n * rate + kk * muLeague) / (n + kk);
}
