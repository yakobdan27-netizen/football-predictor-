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

/** Binary O/U or Yes/No markets — at most one side may appear in DM top-3. */
const BINARY_MARKET_KEYS = new Set<string>([
  "btts",
  "total_goals_ou",
  "home_goals_ou",
  "away_goals_ou",
  "corners_ou",
  "corners",
  "team_corners",
  "shots_ou",
  "home_shots_ou",
  "away_shots_ou",
  "sot_ou",
  "home_sot_ou",
  "away_sot_ou",
  "throw_ins_ou",
  "offsides_ou",
]);

/** Normalize side labels so Reco "Over 2.5" and League "over" can merge. */
export function normalizePredictionToken(prediction: string): string {
  const p = prediction.trim().toLowerCase().replace(/\s+/g, " ");
  if (p === "yes" || p === "btts yes") return "yes";
  if (p === "no" || p === "btts no") return "no";
  // Line lives in marketIdentity separately — collapse "over 2.5" → "over"
  if (/^over(?:\s+[\d.]+)?$/.test(p)) return "over";
  if (/^under(?:\s+[\d.]+)?$/.test(p)) return "under";
  return p;
}

export function isBinaryMarketKey(marketKey: string): boolean {
  const key = marketKey.toLowerCase();
  if (BINARY_MARKET_KEYS.has(key)) return true;
  if (key === "btts") return true;
  if (key.endsWith("_ou") || key.includes("_ou_")) return true;
  return false;
}

/**
 * Group key for complementary sides of the same binary market.
 * Returns null for non-binary markets (1x2, HSH, etc.).
 */
export function binaryMarketGroupKey(m: {
  marketKey: string;
  line?: number;
}): string | null {
  if (!isBinaryMarketKey(m.marketKey)) return null;
  const line = m.line != null && Number.isFinite(m.line) ? String(m.line) : "";
  return `${m.marketKey.toLowerCase()}::${line}`;
}

export function marketIdentity(m: {
  marketKey: string;
  prediction: string;
  line?: number;
}): string {
  const line = m.line != null && Number.isFinite(m.line) ? String(m.line) : "";
  const pred = normalizePredictionToken(m.prediction);
  return `${m.marketKey}::${pred}::${line}`.toLowerCase();
}
