import type { LogMarketKey } from "../types";
import type { DecisionMarketCategory } from "./types";

const GOAL_KEYS = new Set<string>([
  "1x2",
  "double_chance",
  "btts",
  "total_goals_ou",
  "home_goals_ou",
  "away_goals_ou",
  "correct_score",
]);

const CORNER_KEYS = new Set<string>(["corners_ou", "corners", "team_corners"]);

const SPECIALIZED_KEYS = new Set<string>([
  "handicap",
  "ht_handicap",
  "three_way_handicap",
  "ht_1x2",
  "more_goals_half",
  "draw_one_half",
  "win_one_half",
  "shots_ou",
  "home_shots_ou",
  "away_shots_ou",
  "sot_ou",
  "home_sot_ou",
  "away_sot_ou",
  "throw_ins_ou",
  "offsides_ou",
  "hsh",
  "half_comparison",
  "conceded_half",
]);

export function categoryForMarketKey(
  marketKey: string,
  hint?: DecisionMarketCategory
): DecisionMarketCategory {
  if (hint) return hint;
  const key = marketKey.toLowerCase();
  if (CORNER_KEYS.has(key) || key.includes("corner")) return "corners";
  if (GOAL_KEYS.has(key)) return "goals";
  if (
    SPECIALIZED_KEYS.has(key) ||
    key.includes("handicap") ||
    key.includes("half") ||
    key.includes("ht") ||
    key.includes("combo")
  ) {
    return "specialized";
  }
  return "goals";
}

export function categoryForLogMarket(key: LogMarketKey): DecisionMarketCategory {
  return categoryForMarketKey(key);
}

export function categoryIcon(category: DecisionMarketCategory): string {
  switch (category) {
    case "goals":
      return "⚽";
    case "corners":
      return "🏟️";
    case "specialized":
      return "⏱️";
  }
}

export function marketIdentity(m: {
  marketKey: string;
  prediction: string;
  line?: number;
}): string {
  const line = m.line != null && Number.isFinite(m.line) ? String(m.line) : "";
  return `${m.marketKey}::${m.prediction}::${line}`.toLowerCase();
}
