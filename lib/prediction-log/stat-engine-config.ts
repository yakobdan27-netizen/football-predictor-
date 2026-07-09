export const STAT_ENGINE_CONFIG = {
  ROLLING_WINDOW_N: 6,
  DIXON_COLES_RHO: -0.13,
  USE_BIVARIATE: false,
  BIVARIATE_LAMBDA3: 0.15,
  SCORE_GRID_MAX: 8,
  BLEND_DC_WEIGHT: 0.6,
  BLEND_ML_WEIGHT: 0.4,
  STAT_VS_CUSTOM: 0.7,
  ML_RANDOMFOREST_MIN_N: 100,
  RETRAIN_ON_RESULT: true,
  STRENGTH_CLAMP_MIN: 0.3,
  STRENGTH_CLAMP_MAX: 3.0,
  DEFAULT_LEAGUE_HOME_GOALS: 1.5,
  DEFAULT_LEAGUE_AWAY_GOALS: 1.2,
  ML_MIN_SAMPLES_LOGISTIC: 10,
  ML_MIN_SAMPLES_NAIVE: 3,
} as const;

export type MlStrategy = "direct" | "goal_based";

export type MlAlgorithm = "logistic" | "random_forest" | "naive_bayes";
