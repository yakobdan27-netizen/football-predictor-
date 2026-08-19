import type { MarketFamilyId } from "@/lib/slip-builder/types";
import type { MsamConflictGroup } from "./types";

const FAMILY_TO_CONFLICT: Record<MarketFamilyId, MsamConflictGroup> = {
  RESULT_1X2: "RESULT_MARGIN",
  DOUBLE_CHANCE: "RESULT_MARGIN",
  HANDICAP: "RESULT_MARGIN",
  TOTALS: "TOTAL_GOALS",
  TEAM_GOALS: "TEAM_GOALS",
  BTTS: "BTTS_GOALS",
  HALF_GOALS: "HALF_STRUCTURE",
  HSH: "HALF_STRUCTURE",
  HT_RESULT: "HALF_STRUCTURE",
  DIEH: "HALF_STRUCTURE",
  WIN_ONE_HALF: "HALF_STRUCTURE",
  CORNERS: "CORNERS",
  SOT: "CORNERS",
  COMBO: "COMBO",
};

export function msamConflictGroupOf(family: MarketFamilyId): MsamConflictGroup {
  return FAMILY_TO_CONFLICT[family];
}

/** Estimate dependence overlap 0–1 from shared conflict group and probability proximity. */
export function estimateOverlap(
  a: { conflictGroup: MsamConflictGroup; rawProbability: number; marketFamily: MarketFamilyId },
  b: { conflictGroup: MsamConflictGroup; rawProbability: number; marketFamily: MarketFamilyId }
): number {
  if (a.conflictGroup !== b.conflictGroup) return 0;
  if (a.marketFamily === b.marketFamily) {
    const complement = Math.abs(a.rawProbability + b.rawProbability - 1);
    if (complement < 0.05) return 0.85;
    return 0.55;
  }
  return 0.35;
}
