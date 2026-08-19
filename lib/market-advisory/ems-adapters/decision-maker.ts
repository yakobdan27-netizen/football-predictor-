import type { ScoredDecisionMarket } from "@/lib/prediction-log/decision-maker/types";
import { parseDmMarketToCode } from "../market-catalog";
import type { EmsCandidate, EmsSnapshot } from "../types";

export function snapshotDecisionMakerEms(
  markets: ScoredDecisionMarket[]
): EmsSnapshot {
  const candidates: EmsCandidate[] = [];
  markets.forEach((m, i) => {
    if (m.confidence <= 0 && m.label.toLowerCase().includes("insufficient")) {
      return;
    }
    const code =
      parseDmMarketToCode(m.marketKey, m.prediction, m.line) ??
      `${m.marketKey}:${m.prediction}`;
    candidates.push({
      marketCode: code,
      marketLabel: m.label,
      prediction: m.prediction,
      emsScore: m.totalScore,
      emsConfidence: m.confidence,
      existingRank: i + 1,
    });
  });
  return {
    kind: "decision_maker",
    candidates,
    snapshotVersion: "dm-ems-v1",
  };
}
