/**
 * Reliability calibration for slip-builder legs.
 * Uses scored prediction history; falls back to Bayesian calibration log.
 */
import {
  applyBinCalibrator,
  type BinCalibrator,
} from "@/lib/predictor/calibration";
import { buildCalibratorFromBatches } from "@/lib/prediction-log/global-calibration";
import {
  buildCalibratorFromLog,
  type BayesianCalibrationLog,
} from "@/lib/prediction-log/bayesian-calibration";
import type { PredictionBatch } from "@/lib/prediction-log/types";

export type SlipCalibrationResult = {
  pCalibrated: number;
  calibrated: boolean;
  /** Approximate CI width for tie-break (smaller = more certain). */
  ciWidth: number;
};

/**
 * Fit calibrator: prefer scored batches; else Bayesian log when ≥20 samples.
 */
export function fitSlipCalibrator(
  batches: PredictionBatch[],
  bayesianLog?: BayesianCalibrationLog | null
): BinCalibrator | null {
  const fromBatches = buildCalibratorFromBatches(batches);
  if (fromBatches) return fromBatches;
  if (bayesianLog) return buildCalibratorFromLog(bayesianLog);
  return null;
}

/**
 * CI width proxy for tie-breaks:
 * - With calibrator: |scale − 1| / nBins + 1/√n_effective
 * - Without: wide default 0.25 (uncalibrated)
 */
export function estimateCiWidth(
  pRaw: number,
  nEffective: number,
  calibrator: BinCalibrator | null
): number {
  const sampleTerm =
    nEffective > 0 ? 1 / Math.sqrt(nEffective) : 0.25;
  if (!calibrator) return Math.min(0.5, 0.25 + sampleTerm);
  const idx = Math.min(
    calibrator.nBins - 1,
    Math.max(0, Math.floor(Math.min(Math.max(pRaw, 0), 0.999) * calibrator.nBins))
  );
  const scale = calibrator.scales[idx] ?? 1;
  const calTerm = Math.abs(scale - 1) / Math.max(1, calibrator.nBins);
  return Math.min(0.5, calTerm + sampleTerm);
}

export function applySlipCalibration(
  pRaw: number,
  nEffective: number,
  calibrator: BinCalibrator | null
): SlipCalibrationResult {
  if (!calibrator) {
    return {
      pCalibrated: pRaw,
      calibrated: false,
      ciWidth: estimateCiWidth(pRaw, nEffective, null),
    };
  }
  const pCalibrated = applyBinCalibrator(pRaw, calibrator);
  return {
    pCalibrated,
    calibrated: true,
    ciWidth: estimateCiWidth(pRaw, nEffective, calibrator),
  };
}
