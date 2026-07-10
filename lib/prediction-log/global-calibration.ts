import { fitBinCalibrator, reliabilityBins, type BinCalibrator, type CalibrationBin } from "@/lib/predictor/calibration";
import { flattenScoredRows } from "./analysis";
import type { AnalysisHistory, PredictionBatch } from "./types";

export interface GlobalCalibrationBin {
  label: string;
  claimedPct: number;
  hitRatePct: number | null;
  count: number;
  gapPct: number | null;
}

export interface GlobalCalibrationReport {
  sampleSize: number;
  bins: GlobalCalibrationBin[];
  overallClaimedPct: number | null;
  overallHitRatePct: number | null;
  note: string;
}

const MIN_CALIBRATOR_SAMPLES = 20;

function collectPredictedActual(batches: PredictionBatch[]): {
  predicted: number[];
  actual: number[];
} {
  const rows = flattenScoredRows(batches);
  const predicted: number[] = [];
  const actual: number[] = [];
  for (const r of rows) {
    if (r.result !== "correct" && r.result !== "wrong") continue;
    if (r.confidence == null || !Number.isFinite(r.confidence)) continue;
    predicted.push(Math.min(1, Math.max(0, r.confidence / 100)));
    actual.push(r.result === "correct" ? 1 : 0);
  }
  return { predicted, actual };
}

/** Fit bin calibrator from scored history (confidence vs hit). */
export function buildCalibratorFromBatches(
  batches: PredictionBatch[]
): BinCalibrator | null {
  const { predicted, actual } = collectPredictedActual(batches);
  if (predicted.length < MIN_CALIBRATOR_SAMPLES) return null;
  return fitBinCalibrator(predicted, actual, 10, 5);
}

export function buildCalibratorFromAnalysis(
  _analysis: AnalysisHistory,
  batches: PredictionBatch[]
): BinCalibrator | null {
  return buildCalibratorFromBatches(batches);
}

function toReportBins(raw: CalibrationBin[]): GlobalCalibrationBin[] {
  return raw.map((b) => {
    const claimedPct = Math.round(b.predicted * 1000) / 10;
    const hitRatePct = b.count > 0 ? Math.round(b.observed * 1000) / 10 : null;
    const gapPct =
      hitRatePct != null ? Math.round((hitRatePct - claimedPct) * 10) / 10 : null;
    return {
      label: b.bin,
      claimedPct,
      hitRatePct,
      count: b.count,
      gapPct,
    };
  });
}

/** Dashboard report: when we claimed ~X%, how often did we hit? */
export function buildGlobalCalibrationReport(
  batches: PredictionBatch[]
): GlobalCalibrationReport {
  const { predicted, actual } = collectPredictedActual(batches);
  const sampleSize = predicted.length;

  if (sampleSize === 0) {
    return {
      sampleSize: 0,
      bins: [],
      overallClaimedPct: null,
      overallHitRatePct: null,
      note: "Enter and save results to build calibration history.",
    };
  }

  const rawBins = reliabilityBins(predicted, actual, 10);
  const bins = toReportBins(rawBins);
  const sumPred = predicted.reduce((a, b) => a + b, 0);
  const sumHit = actual.reduce((a, b) => a + b, 0);
  const overallClaimedPct = Math.round((sumPred / sampleSize) * 1000) / 10;
  const overallHitRatePct = Math.round((sumHit / sampleSize) * 1000) / 10;

  let note = `Across ${sampleSize} scored picks, claimed avg ${overallClaimedPct}% vs actual ${overallHitRatePct}%.`;
  if (sampleSize < MIN_CALIBRATOR_SAMPLES) {
    note += ` Need ${MIN_CALIBRATOR_SAMPLES - sampleSize} more for live probability calibration.`;
  } else {
    const gap = Math.round((overallHitRatePct - overallClaimedPct) * 10) / 10;
    if (gap < -5) note += " System tends to overconfidence — calibration will pull probs down.";
    else if (gap > 5) note += " System tends to underconfidence — calibration will lift probs.";
    else note += " Calibration looks roughly aligned.";
  }

  return {
    sampleSize,
    bins,
    overallClaimedPct,
    overallHitRatePct,
    note,
  };
}
