/**
 * Pure market evaluation for bet settlement.
 * Never invents scores — missing half data → VOID.
 */
import type { BetMarketType, BetSelectionResult } from "./constants";

export type FinalMatchState = {
  homeGoals: number | null;
  awayGoals: number | null;
  /** First-half goals if known from events; null = unavailable. */
  homeGoals1h: number | null;
  awayGoals1h: number | null;
  status: string;
};

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

export function evaluate(
  marketType: string,
  label: string,
  final: FinalMatchState
): BetSelectionResult {
  const hg = final.homeGoals;
  const ag = final.awayGoals;
  const lab = normalizeLabel(label);
  const mt = marketType as BetMarketType;

  if (hg == null || ag == null) return "VOID";

  switch (mt) {
    case "1X2": {
      if (lab === "home" || lab === "1" || lab === "h") {
        return hg > ag ? "WON" : "LOST";
      }
      if (lab === "draw" || lab === "x" || lab === "d") {
        return hg === ag ? "WON" : "LOST";
      }
      if (lab === "away" || lab === "2" || lab === "a") {
        return ag > hg ? "WON" : "LOST";
      }
      return "VOID";
    }
    case "OU_2_5": {
      const total = hg + ag;
      if (lab.startsWith("over") || lab === "o" || lab === "o2.5") {
        return total > 2.5 ? "WON" : "LOST";
      }
      if (lab.startsWith("under") || lab === "u" || lab === "u2.5") {
        return total < 2.5 ? "WON" : "LOST";
      }
      return "VOID";
    }
    case "BTTS": {
      const both = hg > 0 && ag > 0;
      if (lab === "yes" || lab === "y") return both ? "WON" : "LOST";
      if (lab === "no" || lab === "n") return !both ? "WON" : "LOST";
      return "VOID";
    }
    case "DC": {
      // 1X / 12 / X2
      if (lab === "1x" || lab === "home or draw") {
        return hg >= ag ? "WON" : "LOST";
      }
      if (lab === "12" || lab === "home or away") {
        return hg !== ag ? "WON" : "LOST";
      }
      if (lab === "x2" || lab === "draw or away") {
        return ag >= hg ? "WON" : "LOST";
      }
      return "VOID";
    }
    case "1H_OU_0_5": {
      if (final.homeGoals1h == null || final.awayGoals1h == null) return "VOID";
      const t = final.homeGoals1h + final.awayGoals1h;
      if (lab.startsWith("over") || lab === "o") return t > 0.5 ? "WON" : "LOST";
      if (lab.startsWith("under") || lab === "u") return t < 0.5 ? "WON" : "LOST";
      return "VOID";
    }
    case "2H_OU_0_5": {
      if (final.homeGoals1h == null || final.awayGoals1h == null) return "VOID";
      const h2 = Math.max(0, hg - final.homeGoals1h);
      const a2 = Math.max(0, ag - final.awayGoals1h);
      const t = h2 + a2;
      if (lab.startsWith("over") || lab === "o") return t > 0.5 ? "WON" : "LOST";
      if (lab.startsWith("under") || lab === "u") return t < 0.5 ? "WON" : "LOST";
      return "VOID";
    }
    default:
      console.warn("[bets] unknown market_type", marketType, label);
      return "VOID";
  }
}
