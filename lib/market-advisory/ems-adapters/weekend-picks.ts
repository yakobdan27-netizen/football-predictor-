import { buildMarketCode } from "../market-catalog";
import { FAMILY_LABELS } from "@/lib/slip-builder/families";
import type { BestMarketPick } from "@/lib/match-centre/weekend-opportunities";
import type { EmsCandidate, EmsSnapshot } from "../types";

export function snapshotWeekendPicksEms(
  pick: BestMarketPick
): EmsSnapshot {
  const candidates: EmsCandidate[] = [];
  if (pick) {
    const code = buildMarketCode(
      pick.family,
      pick.selectionKey,
      pick.line,
      pick.comboId
    );
    candidates.push({
      marketCode: code,
      marketLabel: pick.marketLabel || FAMILY_LABELS[pick.family],
      prediction: pick.predictionLabel,
      emsScore: 100 * pick.pCalibrated,
      emsConfidence: Math.round(100 * pick.pCalibrated),
      existingRank: 1,
    });
  }
  return {
    kind: "weekend_picks",
    candidates,
    snapshotVersion: "wp-ems-v1",
  };
}
