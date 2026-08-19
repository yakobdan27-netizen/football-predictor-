import type { AnalysisHistory } from "@/lib/prediction-log/types";
import type { BinCalibrator } from "@/lib/predictor/calibration";
import { MIN_CALIBRATION_SAMPLES } from "../config";
import type { CanonicalProposition } from "../types";

export type CqsInput = {
  prop: CanonicalProposition;
  calibrator: BinCalibrator | null;
  analysis: AnalysisHistory | null;
  cqsBootstrap: boolean;
};

export function scoreCqs(input: CqsInput): { score: number; bootstrap: boolean } {
  const { prop, calibrator, analysis, cqsBootstrap } = input;
  let base = 50;

  if (calibrator) {
    const idx = Math.min(
      calibrator.nBins - 1,
      Math.max(0, Math.floor(prop.rawProbability * calibrator.nBins))
    );
    const scale = calibrator.scales[idx] ?? 1;
    const reliability = 1 - Math.min(1, Math.abs(scale - 1));
    base = 40 + reliability * 40;
  }

  const familyKey = prop.marketFamily.toLowerCase() as import("@/lib/prediction-log/types").LogMarketKey;
  const marketAcc = analysis?.marketAccuracy?.[familyKey];
  const sample = marketAcc ? marketAcc.correct + marketAcc.wrong : 0;
  if (marketAcc && sample >= MIN_CALIBRATION_SAMPLES) {
    const hitRate = marketAcc.correct / sample;
    const gap = Math.abs(hitRate - prop.rawProbability);
    base = Math.max(base, 100 * (1 - Math.min(0.5, gap)));
  }

  if (!calibrator && !cqsBootstrap) {
    return { score: 0, bootstrap: false };
  }

  return {
    score: Math.max(0, Math.min(100, base)),
    bootstrap: cqsBootstrap || !calibrator,
  };
}

/** Placeholder ECE from calibrator metadata — diagnostics only. */
export function cqsDiagnostics(
  calibrator: BinCalibrator | null
): Record<string, unknown> {
  if (!calibrator) return { ece: null, source: "none" };
  return {
    ece: null,
    source: "bootstrap_slip",
    nBins: calibrator.nBins,
  };
}
