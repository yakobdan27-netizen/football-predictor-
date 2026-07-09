import type { QualityTier } from "./teams-quality-types";

export const BAYESIAN_CONFIG = {
  USE_BAYESIAN_LAYER: true,
  BAYESIAN_FEEDS_SIGNAL: false,
  GAMMA_PRIOR_DEFAULT: { shape: 2.4, rate: 1.7 },
  BETA_PRIOR_DEFAULT: { alpha: 3, beta: 3 },
  TIER_PRIOR_BOOST: { A: 0.6, B: 0.3, C: 0, D: -0.3 } as Record<QualityTier, number>,
  FORM_DECAY_GAMMA: 0.95,
  HOME_ADVANTAGE: 1.15,
  AWAY_FACTOR: 0.9,
  MONTE_CARLO_SAMPLES: 2000,
  MONTE_CARLO_SAMPLES_FAST: 400,
  CREDIBLE_LEVEL: 0.95,
  MAX_INTERVAL_WIDTH_SAFE: 0.2,
  MAX_INTERVAL_WIDTH_BALANCED: 0.35,
} as const;
