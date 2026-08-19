/** Versioned MSAM configuration — change only via config_versions table in production. */

export const MSAM_MODEL_VERSION = "msam-1.0.0";
export const COLLABORATION_POLICY_VERSION = "collab-1.0.0";
export const DATA_POLICY_VERSION = "data-60-40-v1";

export const MSAM_SCORE_WEIGHTS = {
  ops: 0.25,
  cqs: 0.25,
  ecs: 0.2,
  sss: 0.15,
  iss: 0.1,
  dis: 0.05,
} as const;

export const INTEGRITY_TOLERANCE = 1e-9;
export const TAIL_MASS_TOLERANCE = 0.002;
export const SCORE_GRID_CAP = 9;

export const MIN_ESS_DEFAULT = 8;
export const MIN_ESS_HALF = 12;
export const MIN_ESS_CORNERS = 15;
export const MIN_CALIBRATION_SAMPLES = 20;

export const SSS_HIGH_SENSITIVITY = 0.12;
export const SSS_PERTURBATION_COUNT = 7;

export const SELECTION_PRIMARY_TARGET = 3;
export const SELECTION_MAX_CANDIDATES = 5;
export const OVERLAP_PENALTY_LAMBDA = 8;

export const COLLABORATION_WEIGHT_EMS = 0.5;
export const COLLABORATION_WEIGHT_MSAM = 0.5;
export const AGREEMENT_BONUS_MAX = 5;
export const CONFLICT_PENALTY_MAX = 4;

export const TARGET_API_WEIGHT = 0.6;
export const TARGET_SYSTEM_WEIGHT = 0.4;
