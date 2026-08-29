import { buildMarketCode } from "@/lib/market-advisory/market-catalog";
import type { ScoredLeg } from "./weekend-opportunities";

/** Normalize team corner line into selection key suffix (4.5 → 4_5). */
export function teamCornerSelectionKey(
  side: "home" | "away",
  direction: "over" | "under",
  line: number
): string {
  const linePart = String(line).replace(".", "_");
  return `${side}_${direction}_${linePart}`;
}

/** Map a scored portfolio leg to a stable MSAM market code. */
export function legToMarketCode(leg: ScoredLeg): string {
  if (leg.family === "COMBO" && leg.comboId) {
    return buildMarketCode("COMBO", leg.comboId, undefined, leg.comboId);
  }
  return buildMarketCode(leg.family, leg.selectionKey, leg.line, leg.comboId);
}
