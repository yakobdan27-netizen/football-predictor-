import type { MarketFamilyId } from "@/lib/slip-builder/types";
import type { CanonicalProposition } from "../types";

const ISS_BASE: Record<MarketFamilyId, number> = {
  RESULT_1X2: 95,
  DOUBLE_CHANCE: 88,
  HANDICAP: 82,
  TOTALS: 92,
  TEAM_GOALS: 85,
  BTTS: 90,
  HALF_GOALS: 75,
  HSH: 78,
  HT_RESULT: 72,
  DIEH: 70,
  WIN_ONE_HALF: 68,
  CORNERS: 65,
  SOT: 60,
  COMBO: 80,
};

export function scoreIss(prop: CanonicalProposition): number {
  let base = ISS_BASE[prop.marketFamily] ?? 50;
  if (!prop.coherenceOk) base *= 0.6;
  if (prop.marketFamily === "COMBO" && prop.comboId) base += 5;
  return Math.max(0, Math.min(100, base));
}
