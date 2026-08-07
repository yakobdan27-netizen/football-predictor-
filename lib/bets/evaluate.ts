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
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

function ouLine(marketType: string): number | null {
  const m = marketType.match(/OU_(\d+)_(\d+)/);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 10;
}

function evalOu(
  total: number,
  lab: string,
  line: number
): BetSelectionResult {
  if (lab.startsWith("over") || lab === "o" || lab === `o${line}`) {
    return total > line ? "WON" : "LOST";
  }
  if (lab.startsWith("under") || lab === "u" || lab === `u${line}`) {
    return total < line ? "WON" : "LOST";
  }
  return "VOID";
}

function resultSide(hg: number, ag: number): "home" | "draw" | "away" {
  if (hg > ag) return "home";
  if (ag > hg) return "away";
  return "draw";
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
    case "DC": {
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
    case "DNB": {
      if (hg === ag) return "VOID";
      if (lab === "home" || lab === "1" || lab === "h") {
        return hg > ag ? "WON" : "LOST";
      }
      if (lab === "away" || lab === "2" || lab === "a") {
        return ag > hg ? "WON" : "LOST";
      }
      return "VOID";
    }
    case "OU_0_5":
    case "OU_1_5":
    case "OU_2_5":
    case "OU_3_5":
    case "OU_4_5": {
      const line = ouLine(mt);
      if (line == null) return "VOID";
      return evalOu(hg + ag, lab, line);
    }
    case "BTTS": {
      const both = hg > 0 && ag > 0;
      if (lab === "yes" || lab === "y") return both ? "WON" : "LOST";
      if (lab === "no" || lab === "n") return !both ? "WON" : "LOST";
      return "VOID";
    }
    case "1H_1X2": {
      if (final.homeGoals1h == null || final.awayGoals1h == null) return "VOID";
      const h = final.homeGoals1h;
      const a = final.awayGoals1h;
      if (lab === "home" || lab === "1" || lab === "h") {
        return h > a ? "WON" : "LOST";
      }
      if (lab === "draw" || lab === "x" || lab === "d") {
        return h === a ? "WON" : "LOST";
      }
      if (lab === "away" || lab === "2" || lab === "a") {
        return a > h ? "WON" : "LOST";
      }
      return "VOID";
    }
    case "1H_OU_0_5":
    case "1H_OU_1_5": {
      if (final.homeGoals1h == null || final.awayGoals1h == null) return "VOID";
      const line = ouLine(mt);
      if (line == null) return "VOID";
      return evalOu(final.homeGoals1h + final.awayGoals1h, lab, line);
    }
    case "2H_OU_0_5":
    case "2H_OU_1_5": {
      if (final.homeGoals1h == null || final.awayGoals1h == null) return "VOID";
      const h2 = Math.max(0, hg - final.homeGoals1h);
      const a2 = Math.max(0, ag - final.awayGoals1h);
      const line = ouLine(mt);
      if (line == null) return "VOID";
      return evalOu(h2 + a2, lab, line);
    }
    case "HALF_MOST_GOALS": {
      if (final.homeGoals1h == null || final.awayGoals1h == null) return "VOID";
      const g1 = final.homeGoals1h + final.awayGoals1h;
      const g2 =
        Math.max(0, hg - final.homeGoals1h) +
        Math.max(0, ag - final.awayGoals1h);
      if (lab === "1h" || lab === "first" || lab === "first half") {
        return g1 > g2 ? "WON" : "LOST";
      }
      if (lab === "2h" || lab === "second" || lab === "second half") {
        return g2 > g1 ? "WON" : "LOST";
      }
      if (lab === "equal" || lab === "draw" || lab === "x") {
        return g1 === g2 ? "WON" : "LOST";
      }
      return "VOID";
    }
    case "RESULT_BTTS": {
      const side = resultSide(hg, ag);
      const both = hg > 0 && ag > 0;
      const parts = lab.split(/[+/]/).map((s) => s.trim());
      if (parts.length < 2) return "VOID";
      const [rRaw, bRaw] = parts;
      let wantSide: "home" | "draw" | "away" | null = null;
      if (rRaw === "home" || rRaw === "1" || rRaw === "h") wantSide = "home";
      else if (rRaw === "draw" || rRaw === "x" || rRaw === "d") wantSide = "draw";
      else if (rRaw === "away" || rRaw === "2" || rRaw === "a") wantSide = "away";
      if (!wantSide) return "VOID";
      const wantBtts =
        bRaw === "yes" || bRaw === "y"
          ? true
          : bRaw === "no" || bRaw === "n"
            ? false
            : null;
      if (wantBtts == null) return "VOID";
      return side === wantSide && both === wantBtts ? "WON" : "LOST";
    }
    case "RESULT_OU_2_5": {
      const side = resultSide(hg, ag);
      const over = hg + ag > 2.5;
      const parts = lab.split(/[+/]/).map((s) => s.trim());
      if (parts.length < 2) return "VOID";
      const [rRaw, oRaw] = parts;
      let wantSide: "home" | "draw" | "away" | null = null;
      if (rRaw === "home" || rRaw === "1" || rRaw === "h") wantSide = "home";
      else if (rRaw === "draw" || rRaw === "x" || rRaw === "d") wantSide = "draw";
      else if (rRaw === "away" || rRaw === "2" || rRaw === "a") wantSide = "away";
      if (!wantSide) return "VOID";
      const wantOver =
        oRaw.startsWith("over") || oRaw === "o"
          ? true
          : oRaw.startsWith("under") || oRaw === "u"
            ? false
            : null;
      if (wantOver == null) return "VOID";
      return side === wantSide && over === wantOver ? "WON" : "LOST";
    }
    default:
      console.warn("[bets] unknown market_type", marketType, label);
      return "VOID";
  }
}
