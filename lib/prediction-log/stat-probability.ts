import { applyBinCalibrator, type BinCalibrator } from "@/lib/predictor/calibration";
import { BAYESIAN_CONFIG } from "./bayesian-config";
import { STAT_ENGINE_CONFIG } from "./stat-engine-config";import type { DixonColesResult } from "./statistics-engine";
import { dcProbToPercent } from "./statistics-engine";
import type { MlOutcomeProbs } from "./ml-model-store";
import { mlProbForPick, mlProbToPercent } from "./ml-engine";
import type { LogMarketKey } from "./types";

export function computePStat(
  dcResult: DixonColesResult,
  mlProbs: MlOutcomeProbs,
  marketKey: LogMarketKey,
  prediction: string,
  line?: number
): { pDc: number; pMl: number; pStat: number } {
  const pDc = dcProbToPercent(dcResult.marketProb);
  const mlPickProb = mlProbForPick(mlProbs, prediction);
  const pMl = mlProbToPercent(mlPickProb);

  const wDc = STAT_ENGINE_CONFIG.BLEND_DC_WEIGHT;
  const wMl = STAT_ENGINE_CONFIG.BLEND_ML_WEIGHT;
  const pStat = Math.round(wDc * pDc + wMl * pMl);
  return { pDc, pMl, pStat };
}

export function shrinkPStat(pStat: number, sampleSize: number, minFullTrust = 8): number {
  if (BAYESIAN_CONFIG.BAYESIAN_FEEDS_SIGNAL) return pStat;
  const reliability = Math.max(0, Math.min(1, sampleSize / minFullTrust));
  return Math.round(50 + (pStat - 50) * reliability);
}

export function confidenceFromInterval(width: number, level = BAYESIAN_CONFIG.CREDIBLE_LEVEL): number {
  const maxWidth = level >= 0.9 ? 0.6 : 0.5;
  return Math.max(0, Math.min(1, 1 - width / maxWidth));
}
export function applyCalibration(pStat: number, calibrator: BinCalibrator | null): number {
  if (!calibrator) return pStat;
  const scaled = applyBinCalibrator(pStat / 100, calibrator);
  return Math.round(Math.max(0, Math.min(100, scaled * 100)));
}

export function blendSignalWithStat(
  pStat: number,
  pCustom: number
): number {
  const w = STAT_ENGINE_CONFIG.STAT_VS_CUSTOM;
  return Math.round(w * pStat + (1 - w) * pCustom);
}
