import { buildMarketCode } from "../market-catalog";
import { FAMILY_LABELS } from "@/lib/slip-builder/families";
import type { ScoredLeg } from "@/lib/match-centre/weekend-opportunities";
import type { EmsCandidate, EmsSnapshot } from "../types";

export function snapshotWeekendPortfolioEms(
  leg: ScoredLeg,
  marketCode: string
): EmsSnapshot {
  const candidates: EmsCandidate[] = [
    {
      marketCode,
      marketLabel: leg.marketLabel || FAMILY_LABELS[leg.family],
      prediction: leg.predictionLabel,
      emsScore: 100 * leg.pCalibrated,
      emsConfidence: Math.round(100 * leg.pCalibrated),
      existingRank: 1,
    },
  ];
  return {
    kind: "weekend_portfolio",
    candidates,
    snapshotVersion: "wpf-ems-v1",
  };
}

/** Re-export for callers that only have family/selection fields. */
export function marketCodeFromLeg(leg: ScoredLeg): string {
  if (leg.family === "COMBO" && leg.comboId) {
    return buildMarketCode("COMBO", leg.comboId, undefined, leg.comboId);
  }
  return buildMarketCode(leg.family, leg.selectionKey, leg.line, leg.comboId);
}
