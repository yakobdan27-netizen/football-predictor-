import type {
  BacktestCompareResult,
  BacktestMetricsResult,
  BacktestOptions,
  MatchRow,
  PredictionResult,
} from "./types";
import { FootballPredictor } from "./index";
import { b365FromRow } from "./odds-lookup";
import { enhancePrediction, fitCalibratorFromRows } from "./enhance-prediction";
import {
  actualOutcome1x2,
  expectedCalibrationError,
  reliabilityBins,
} from "./calibration";

function actualOutcome(hg: number, ag: number): [number, number, number] {
  return actualOutcome1x2(hg, ag);
}

function evaluatePredictions(
  evals: {
    pred: PredictionResult;
    hg: number;
    ag: number;
  }[],
  ouLines: number[]
): BacktestMetricsResult {
  let brierSum = 0;
  let logLossSum = 0;
  let correct = 0;
  let goalsErrSum = 0;
  const ouBrier: Record<string, number> = Object.fromEntries(
    ouLines.map((l) => [String(l), 0])
  );
  let brierBttsSum = 0;
  const eps = 1e-15;
  const calib1x2Pred: number[] = [];
  const calib1x2Actual: number[] = [];
  const calibBttsPred: number[] = [];
  const calibBttsActual: number[] = [];

  for (const { pred, hg, ag } of evals) {
    const probs: [number, number, number] = [pred.pHome, pred.pDraw, pred.pAway];
    const actual = actualOutcome(hg, ag);

    brierSum += probs.reduce((s, p, i) => s + (p - actual[i]) ** 2, 0);
    const pActual = probs[0] * actual[0] + probs[1] * actual[1] + probs[2] * actual[2];
    logLossSum -= Math.log(Math.max(pActual, eps));

    const predIdx = probs.indexOf(Math.max(...probs));
    const actIdx = actual.indexOf(1);
    if (predIdx === actIdx) correct++;

    calib1x2Pred.push(Math.max(...probs));
    calib1x2Actual.push(predIdx === actIdx ? 1 : 0);

    const bttsActual = hg > 0 && ag > 0 ? 1 : 0;
    brierBttsSum += (pred.btts.yes - bttsActual) ** 2;
    calibBttsPred.push(pred.btts.yes);
    calibBttsActual.push(bttsActual);

    const actualTotal = hg + ag;
    goalsErrSum += Math.abs(pred.expHomeGoals + pred.expAwayGoals - actualTotal);

    for (const line of ouLines) {
      const [ov] = pred.goalsOverUnder[String(line)] ?? [0.5];
      const wentOver = actualTotal > line ? 1 : 0;
      ouBrier[String(line)] += (ov - wentOver) ** 2;
    }
  }

  const nEval = evals.length;
  const calibration1x2 = reliabilityBins(calib1x2Pred, calib1x2Actual);
  const calibrationBtts = reliabilityBins(calibBttsPred, calibBttsActual);

  return {
    nTest: nEval,
    brier1x2: brierSum / nEval,
    logLoss1x2: logLossSum / nEval,
    accuracy1x2: correct / nEval,
    brierOu: Object.fromEntries(
      Object.entries(ouBrier).map(([k, v]) => [k, v / nEval])
    ),
    brierBtts: brierBttsSum / nEval,
    maeGoals: goalsErrSum / nEval,
    calibration1x2,
    calibrationBtts,
    ece1x2: expectedCalibrationError(calibration1x2),
    eceBtts: expectedCalibrationError(calibrationBtts),
  };
}

export function backtestCompare(
  rows: MatchRow[],
  testFraction = 0.2,
  minTrain = 50,
  decayXi = 0.002,
  options: BacktestOptions = {}
): BacktestCompareResult {
  const engine = new FootballPredictor([1.5, 2.5, 3.5], decayXi);
  const metrics = engine.backtest(rows, testFraction, minTrain);

  if (!options.blendOdds && !options.calibrate) {
    return { metrics };
  }

  const df = [...rows].sort((a, b) => {
    const da = a.Date ?? "";
    const db = b.Date ?? "";
    return da.localeCompare(db);
  });
  const n = df.length;
  const nTest = Math.max(1, Math.floor(n * testFraction));
  const trainDf = df.slice(0, n - nTest);
  const testDf = df.slice(n - nTest);

  const fitEngine = new FootballPredictor([1.5, 2.5, 3.5], decayXi);
  fitEngine.fit(trainDf);

  const blendAlpha = options.blendAlpha ?? 0.5;
  const trainSamples: {
    pHome: number;
    pDraw: number;
    pAway: number;
    hg: number;
    ag: number;
  }[] = [];

  for (const row of trainDf) {
    if (!fitEngine.teams.includes(row.HomeTeam) || !fitEngine.teams.includes(row.AwayTeam))
      continue;
    const raw = fitEngine.predict(row.HomeTeam, row.AwayTeam);
    const marketOdds = b365FromRow(row);
    if (options.blendOdds && !marketOdds) continue;
    const enhanced = enhancePrediction(raw, marketOdds, {
      blendOdds: Boolean(options.blendOdds && marketOdds),
      blendAlpha,
      calibrate: false,
    });
    trainSamples.push({
      pHome: enhanced.pHome,
      pDraw: enhanced.pDraw,
      pAway: enhanced.pAway,
      hg: row.FTHG,
      ag: row.FTAG,
    });
  }

  const calibrator =
    options.calibrate ? fitCalibratorFromRows(trainSamples) : null;

  const testEvals: { pred: PredictionResult; hg: number; ag: number }[] = [];
  for (const row of testDf) {
    if (!fitEngine.teams.includes(row.HomeTeam) || !fitEngine.teams.includes(row.AwayTeam))
      continue;
    const raw = fitEngine.predict(row.HomeTeam, row.AwayTeam);
    const marketOdds = b365FromRow(row);
    const enhanced = enhancePrediction(raw, marketOdds, {
      blendOdds: Boolean(options.blendOdds && marketOdds),
      blendAlpha,
      calibrate: options.calibrate,
      calibrator,
    });
    if (options.blendOdds && !marketOdds) continue;
    testEvals.push({ pred: enhanced, hg: row.FTHG, ag: row.FTAG });
  }

  if (testEvals.length === 0) {
    return { metrics };
  }

  const metricsEnhanced = evaluatePredictions(testEvals, [1.5, 2.5, 3.5]);
  return { metrics, metricsEnhanced };
}
