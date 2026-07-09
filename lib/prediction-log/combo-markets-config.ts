import {
  buildScoreMatrix,
  jointProbPercent,
} from "@/lib/predictor/score-matrix";
import { STAT_ENGINE_CONFIG } from "./stat-engine-config";
import type { ComboMarketDef, LogMarketKey } from "./types";

const DIXON_COLES_RHO = -0.13;
const HT_TIME_FACTOR = 0.45;

export const DEFAULT_COMBO_MARKETS: ComboMarketDef[] = [
  // A. Result + Goals
  { id: "home_btts_yes", label: "Home Win + BTTS Yes", enabled: true, category: "result_goals" },
  { id: "home_btts_no", label: "Home Win + BTTS No", enabled: true, category: "result_goals" },
  { id: "away_btts_yes", label: "Away Win + BTTS Yes", enabled: true, category: "result_goals" },
  { id: "away_btts_no", label: "Away Win + BTTS No", enabled: true, category: "result_goals" },
  { id: "draw_btts_yes", label: "Draw + BTTS Yes", enabled: true, category: "result_goals" },
  { id: "home_over_1_5", label: "Home Win + Over 1.5", enabled: true, category: "result_goals" },
  { id: "home_over_2_5", label: "Home Win + Over 2.5", enabled: true, category: "result_goals" },
  { id: "home_under_3_5", label: "Home Win + Under 3.5", enabled: true, category: "result_goals" },
  { id: "away_over_1_5", label: "Away Win + Over 1.5", enabled: true, category: "result_goals" },
  { id: "away_over_2_5", label: "Away Win + Over 2.5", enabled: true, category: "result_goals" },
  { id: "away_under_3_5", label: "Away Win + Under 3.5", enabled: true, category: "result_goals" },
  { id: "draw_under_2_5", label: "Draw + Under 2.5", enabled: true, category: "result_goals" },
  // B. Double Chance + Goals
  { id: "1x_over_1_5", label: "Home or Draw (1X) + Over 1.5", enabled: true, category: "dc_goals" },
  { id: "1x_btts_yes", label: "Home or Draw (1X) + BTTS Yes", enabled: true, category: "dc_goals" },
  { id: "x2_over_1_5", label: "Away or Draw (X2) + Over 1.5", enabled: true, category: "dc_goals" },
  { id: "x2_btts_yes", label: "Away or Draw (X2) + BTTS Yes", enabled: true, category: "dc_goals" },
  { id: "12_over_2_5", label: "Home or Away (12) + Over 2.5", enabled: true, category: "dc_goals" },
  { id: "12_btts_yes", label: "Home or Away (12) + BTTS Yes", enabled: true, category: "dc_goals" },
  // C. BTTS + Goals
  { id: "btts_yes_over_2_5", label: "BTTS Yes + Over 2.5", enabled: true, category: "btts_goals" },
  { id: "btts_yes_over_3_5", label: "BTTS Yes + Over 3.5", enabled: true, category: "btts_goals" },
  { id: "btts_no_under_2_5", label: "BTTS No + Under 2.5", enabled: true, category: "btts_goals" },
  // D. Result + Total Goals band
  { id: "home_2_3_goals", label: "Home Win + 2–3 goals", enabled: true, category: "goal_band" },
  { id: "away_2_3_goals", label: "Away Win + 2–3 goals", enabled: true, category: "goal_band" },
  { id: "draw_0_2_goals", label: "Draw + 0–2 goals", enabled: true, category: "goal_band" },
  // E. Half combos
  {
    id: "home_ht_home_ft",
    label: "Home Win HT + Home Win FT",
    enabled: true,
    requiresHalfTime: true,
    category: "half",
  },
  {
    id: "draw_ht_home_ft",
    label: "Draw HT + Home Win FT",
    enabled: true,
    requiresHalfTime: true,
    category: "half",
  },
  {
    id: "over_0_5_fh_over_2_5_ft",
    label: "Over 0.5 First Half + Over 2.5 FT",
    enabled: true,
    requiresHalfTime: true,
    category: "half",
  },
  // F. Team-total combos
  {
    id: "home_win_home_over_1_5",
    label: "Home Win + Home Team Over 1.5",
    enabled: true,
    category: "team_total",
  },
  {
    id: "away_win_away_over_1_5",
    label: "Away Win + Away Team Over 1.5",
    enabled: true,
    category: "team_total",
  },
  {
    id: "btts_yes_home_over_1_5",
    label: "BTTS Yes + Home Team Over 1.5",
    enabled: true,
    category: "team_total",
  },
];

function homeWin(h: number, a: number): boolean {
  return h > a;
}
function awayWin(h: number, a: number): boolean {
  return a > h;
}
function draw(h: number, a: number): boolean {
  return h === a;
}
function bttsYes(h: number, a: number): boolean {
  return h >= 1 && a >= 1;
}
function bttsNo(h: number, a: number): boolean {
  return h === 0 || a === 0;
}
function totalOver(h: number, a: number, line: number): boolean {
  return h + a > line;
}
function totalUnder(h: number, a: number, line: number): boolean {
  return h + a < line;
}
function dc1x(h: number, a: number): boolean {
  return h >= a;
}
function dcx2(h: number, a: number): boolean {
  return a >= h;
}
function dc12(h: number, a: number): boolean {
  return h !== a;
}
function goalBand(h: number, a: number, min: number, max: number): boolean {
  const t = h + a;
  return t >= min && t <= max;
}
function homeOver(h: number, _a: number, line: number): boolean {
  return h > line;
}

const FT_PREDICATES: Record<string, (h: number, a: number) => boolean> = {
  home_btts_yes: (h, a) => homeWin(h, a) && bttsYes(h, a),
  home_btts_no: (h, a) => homeWin(h, a) && bttsNo(h, a),
  away_btts_yes: (h, a) => awayWin(h, a) && bttsYes(h, a),
  away_btts_no: (h, a) => awayWin(h, a) && bttsNo(h, a),
  draw_btts_yes: (h, a) => draw(h, a) && bttsYes(h, a),
  home_over_1_5: (h, a) => homeWin(h, a) && totalOver(h, a, 1.5),
  home_over_2_5: (h, a) => homeWin(h, a) && totalOver(h, a, 2.5),
  home_under_3_5: (h, a) => homeWin(h, a) && totalUnder(h, a, 3.5),
  away_over_1_5: (h, a) => awayWin(h, a) && totalOver(h, a, 1.5),
  away_over_2_5: (h, a) => awayWin(h, a) && totalOver(h, a, 2.5),
  away_under_3_5: (h, a) => awayWin(h, a) && totalUnder(h, a, 3.5),
  draw_under_2_5: (h, a) => draw(h, a) && totalUnder(h, a, 2.5),
  "1x_over_1_5": (h, a) => dc1x(h, a) && totalOver(h, a, 1.5),
  "1x_btts_yes": (h, a) => dc1x(h, a) && bttsYes(h, a),
  x2_over_1_5: (h, a) => dcx2(h, a) && totalOver(h, a, 1.5),
  x2_btts_yes: (h, a) => dcx2(h, a) && bttsYes(h, a),
  "12_over_2_5": (h, a) => dc12(h, a) && totalOver(h, a, 2.5),
  "12_btts_yes": (h, a) => dc12(h, a) && bttsYes(h, a),
  btts_yes_over_2_5: (h, a) => bttsYes(h, a) && totalOver(h, a, 2.5),
  btts_yes_over_3_5: (h, a) => bttsYes(h, a) && totalOver(h, a, 3.5),
  btts_no_under_2_5: (h, a) => bttsNo(h, a) && totalUnder(h, a, 2.5),
  home_2_3_goals: (h, a) => homeWin(h, a) && goalBand(h, a, 2, 3),
  away_2_3_goals: (h, a) => awayWin(h, a) && goalBand(h, a, 2, 3),
  draw_0_2_goals: (h, a) => draw(h, a) && goalBand(h, a, 0, 2),
  home_win_home_over_1_5: (h, a) => homeWin(h, a) && homeOver(h, a, 1.5),
  away_win_away_over_1_5: (h, a) => awayWin(h, a) && a > 1.5,
  btts_yes_home_over_1_5: (h, a) => bttsYes(h, a) && homeOver(h, a, 1.5),
};

export interface ComboGridContext {
  grid: number[][];
  lambdaHome?: number;
  lambdaAway?: number;
}

function halfGrids(ctx: ComboGridContext): { ht: number[][]; sh: number[][] } | null {
  if (ctx.lambdaHome == null || ctx.lambdaAway == null) return null;
  const maxGoals = STAT_ENGINE_CONFIG.SCORE_GRID_MAX;
  const ht = buildScoreMatrix(
    ctx.lambdaHome * HT_TIME_FACTOR,
    ctx.lambdaAway * HT_TIME_FACTOR,
    DIXON_COLES_RHO,
    maxGoals
  );
  const sh = buildScoreMatrix(
    ctx.lambdaHome * (1 - HT_TIME_FACTOR),
    ctx.lambdaAway * (1 - HT_TIME_FACTOR),
    DIXON_COLES_RHO,
    maxGoals
  );
  return { ht, sh };
}

function jointHalfFtProb(
  ctx: ComboGridContext,
  predicate: (hHt: number, aHt: number, hFt: number, aFt: number) => boolean
): number | null {
  const halves = halfGrids(ctx);
  if (!halves) return null;
  let sum = 0;
  for (let hHt = 0; hHt < halves.ht.length; hHt++) {
    for (let aHt = 0; aHt < halves.ht[hHt]!.length; aHt++) {
      const pHt = halves.ht[hHt]![aHt]!;
      for (let hSh = 0; hSh < halves.sh.length; hSh++) {
        for (let aSh = 0; aSh < halves.sh[hSh]!.length; aSh++) {
          const p = pHt * halves.sh[hSh]![aSh]!;
          const hFt = hHt + hSh;
          const aFt = aHt + aSh;
          if (predicate(hHt, aHt, hFt, aFt)) sum += p;
        }
      }
    }
  }
  return sum;
}

export function comboGridProbabilityPercent(
  comboId: string,
  ctx: ComboGridContext
): number | null {
  const ftPred = FT_PREDICATES[comboId];
  if (ftPred) {
    return jointProbPercent(ctx.grid, ftPred);
  }

  if (comboId === "home_ht_home_ft") {
    const p = jointHalfFtProb(ctx, (hHt, aHt, hFt, aFt) => hHt > aHt && hFt > aFt);
    return p != null ? Math.round(p * 100) : null;
  }
  if (comboId === "draw_ht_home_ft") {
    const p = jointHalfFtProb(ctx, (hHt, aHt, hFt, aFt) => hHt === aHt && hFt > aFt);
    return p != null ? Math.round(p * 100) : null;
  }
  if (comboId === "over_0_5_fh_over_2_5_ft") {
    const p = jointHalfFtProb(
      ctx,
      (hHt, aHt, hFt, aFt) => hHt + aHt >= 1 && hFt + aFt > 2.5
    );
    return p != null ? Math.round(p * 100) : null;
  }

  return null;
}

export function comboGridProbability(
  comboId: string,
  ctx: ComboGridContext
): number | null {
  const pct = comboGridProbabilityPercent(comboId, ctx);
  return pct != null ? pct / 100 : null;
}

export function getComboTierBoostKey(
  comboId: string
): { marketKey: LogMarketKey; prediction: string } {
  if (comboId.startsWith("away_") || comboId.startsWith("x2_")) {
    if (comboId.includes("btts") || comboId.includes("over") || comboId.includes("under")) {
      return comboId.startsWith("x2") ? { marketKey: "double_chance", prediction: "x2" } : { marketKey: "1x2", prediction: "away" };
    }
    return { marketKey: "1x2", prediction: "away" };
  }
  if (comboId.startsWith("draw_") || comboId === "draw_0_2_goals") {
    return { marketKey: "1x2", prediction: "draw" };
  }
  if (comboId.startsWith("1x_")) {
    return { marketKey: "double_chance", prediction: "1x" };
  }
  if (comboId.startsWith("12_")) {
    return { marketKey: "double_chance", prediction: "12" };
  }
  if (comboId.startsWith("btts_")) {
    return { marketKey: "btts", prediction: comboId.includes("no") ? "no" : "yes" };
  }
  return { marketKey: "1x2", prediction: "home" };
}

export function enabledComboMarkets(markets: ComboMarketDef[]): ComboMarketDef[] {
  return markets.filter((m) => m.enabled);
}

export function mergeComboMarketsWithDefaults(saved: ComboMarketDef[]): ComboMarketDef[] {
  const byId = new Map(saved.map((m) => [m.id, m]));
  const merged = DEFAULT_COMBO_MARKETS.map((def) => {
    const existing = byId.get(def.id);
    return existing ? { ...def, ...existing, label: existing.label || def.label } : def;
  });
  for (const m of saved) {
    if (!DEFAULT_COMBO_MARKETS.some((d) => d.id === m.id)) {
      merged.push(m);
    }
  }
  return merged;
}
