import { blend1x2, blendBinary } from "./blend";
import {
  applyCalibrator1x2,
  actualOutcome1x2,
  fitCalibrator1x2,
  type Calibrator1x2,
} from "./calibration";
import { marketFromB365, type B365Odds } from "./odds";
import type { PredictionResult } from "./types";

export interface EnhanceOptions {
  blendOdds?: boolean;
  blendAlpha?: number;
  calibrate?: boolean;
  calibrator?: Calibrator1x2 | null;
}

export function enhancePrediction(
  prediction: PredictionResult,
  marketOdds: B365Odds | null,
  options: EnhanceOptions = {}
): PredictionResult {
  const {
    blendOdds = false,
    blendAlpha = 0.5,
    calibrate = false,
    calibrator = null,
  } = options;

  const model1x2: [number, number, number] = [
    prediction.pHome,
    prediction.pDraw,
    prediction.pAway,
  ];

  let pHome = prediction.pHome;
  let pDraw = prediction.pDraw;
  let pAway = prediction.pAway;
  let market1x2: [number, number, number] | undefined;
  let blended = false;
  let calibrated = false;

  const market = marketOdds ? marketFromB365(marketOdds) : null;

  if (blendOdds && market?.oneX2) {
    market1x2 = [market.oneX2.pHome, market.oneX2.pDraw, market.oneX2.pAway];
    [pHome, pDraw, pAway] = blend1x2(model1x2, market.oneX2, blendAlpha);
    blended = true;
  }

  if (calibrate && calibrator) {
    [pHome, pDraw, pAway] = applyCalibrator1x2([pHome, pDraw, pAway], calibrator);
    calibrated = true;
  }

  const result: PredictionResult = {
    ...prediction,
    pHome,
    pDraw,
    pAway,
    model1x2,
    market1x2,
    blendAlpha: blendOdds ? blendAlpha : undefined,
    calibrated1x2: calibrated ? [pHome, pDraw, pAway] : undefined,
    blended,
    calibrated,
    doubleChance: {
      oneX: pHome + pDraw,
      xTwo: pDraw + pAway,
      oneTwo: pHome + pAway,
    },
  };

  if (blendOdds && market?.over25 && prediction.goalsOverUnder["2.5"]) {
    const [modelOver] = prediction.goalsOverUnder["2.5"];
    const blendedOver = blendBinary(modelOver, market.over25.over, blendAlpha);
    result.goalsOverUnder = {
      ...prediction.goalsOverUnder,
      "2.5": [blendedOver, 1 - blendedOver],
    };
  }

  return result;
}

export function fitCalibratorFromRows(
  samples: {
    pHome: number;
    pDraw: number;
    pAway: number;
    hg: number;
    ag: number;
  }[]
): Calibrator1x2 | null {
  const valid = samples.filter(
    (s) =>
      Number.isFinite(s.pHome) &&
      Number.isFinite(s.pDraw) &&
      Number.isFinite(s.pAway) &&
      Number.isFinite(s.hg) &&
      Number.isFinite(s.ag)
  );
  if (valid.length < 20) return null;
  const pHome = valid.map((s) => s.pHome);
  const pDraw = valid.map((s) => s.pDraw);
  const pAway = valid.map((s) => s.pAway);
  const actualHome = valid.map((s) => actualOutcome1x2(s.hg, s.ag)[0]);
  const actualDraw = valid.map((s) => actualOutcome1x2(s.hg, s.ag)[1]);
  const actualAway = valid.map((s) => actualOutcome1x2(s.hg, s.ag)[2]);
  return fitCalibrator1x2(pHome, pDraw, pAway, actualHome, actualDraw, actualAway);
}
