export interface MatchRow {
  HomeTeam: string;
  AwayTeam: string;
  FTHG: number;
  FTAG: number;
  Date?: string;
  HTHG?: number;
  HTAG?: number;
  HS?: number;
  AS?: number;
  HST?: number;
  AST?: number;
  HO?: number;
  AO?: number;
  HC?: number;
  AC?: number;
  HTI?: number;
  ATI?: number;
  B365H?: number;
  B365D?: number;
  B365A?: number;
  B365Over25?: number;
  B365Under25?: number;
}

export interface DoubleChanceProbs {
  oneX: number;
  xTwo: number;
  oneTwo: number;
}

export interface BttsProbs {
  yes: number;
  no: number;
}

export interface Half1x2Probs {
  pHome: number;
  pDraw: number;
  pAway: number;
}

export interface MoreGoalsHalfProbs {
  firstHalf: number;
  secondHalf: number;
  equal?: number;
}

export interface CalibrationBinResult {
  bin: string;
  predicted: number;
  observed: number;
  count: number;
}

export interface PredictionResult {
  home: string;
  away: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  expHomeGoals: number;
  expAwayGoals: number;
  goalsOverUnder: Record<string, [number, number]>;
  doubleChance: DoubleChanceProbs;
  btts: BttsProbs;
  homeGoalsOverUnder: Record<string, [number, number]>;
  awayGoalsOverUnder: Record<string, [number, number]>;
  firstHalf?: Half1x2Probs;
  moreGoalsHalf?: MoreGoalsHalfProbs;
  drawAtLeastOneHalf?: number;
  homeWinAtLeastOneHalf?: number;
  awayWinAtLeastOneHalf?: number;
  expCorners?: [number, number];
  cornersOverUnder?: Record<string, [number, number]>;
  expThrowIns?: [number, number];
  throwInsOverUnder?: Record<string, [number, number]>;
  shots?: [number, number];
  shotsOverUnder?: Record<string, [number, number]>;
  shotsOnTarget?: [number, number];
  sotOverUnder?: Record<string, [number, number]>;
  offsides?: [number, number];
  warnings?: string[];
  model1x2?: [number, number, number];
  market1x2?: [number, number, number];
  blendAlpha?: number;
  calibrated1x2?: [number, number, number];
  blended?: boolean;
  calibrated?: boolean;
}

export interface BacktestMetricsResult {
  nTest: number;
  brier1x2: number;
  logLoss1x2: number;
  accuracy1x2: number;
  brierOu: Record<string, number>;
  brierBtts?: number;
  maeGoals: number;
  maeShots?: number;
  maeSot?: number;
  maeOffsides?: number;
  maeCorners?: number;
  calibration1x2?: CalibrationBinResult[];
  calibrationBtts?: CalibrationBinResult[];
  ece1x2?: number;
  eceBtts?: number;
}

export interface BacktestOptions {
  blendOdds?: boolean;
  blendAlpha?: number;
  calibrate?: boolean;
}

export interface BacktestCompareResult {
  metrics: BacktestMetricsResult;
  metricsEnhanced?: BacktestMetricsResult;
}

export interface PredictorOptions {
  promotedFallback?: boolean;
}

export interface FitOptions {
  /** Fit corners/shots/SOT/offsides/throw-ins models (slower). Default true. */
  includeAuxiliary?: boolean;
}
