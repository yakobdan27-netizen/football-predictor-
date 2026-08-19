import type { LogMarketKey } from "../types";
import type { DecisionMarketCategory } from "./types";
import { standardizeTeamName } from "@/lib/data/team-names";

const GOAL_KEYS = new Set<string>([
  "1x2",
  "double_chance",
  "btts",
  "total_goals_ou",
  "home_goals_ou",
  "away_goals_ou",
  "correct_score",
]);

const CORNER_KEYS = new Set<string>([
  "corners_ou",
  "home_corners_ou",
  "corners",
  "team_corners",
]);

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

/** Complementary O/U or Yes/No markets — at most one side in DM top-3. */
const BINARY_OU_KEYS = new Set<string>([
  "btts",
  "total_goals_ou",
  "home_goals_ou",
  "away_goals_ou",
  "corners_ou",
  "home_corners_ou",
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
  "draw_one_half",
]);

/**
 * Mutually exclusive outcome markets (exactly one of home/draw/away, 1H/2H, etc.).
 * Without this, Inter win + Monza win can both enter top-3.
 */
const EXCLUSIVE_OUTCOME_KEYS = new Set<string>([
  "1x2",
  "ht_1x2",
  "three_way_handicap",
  "hsh",
  "more_goals_half",
  "win_one_half",
]);

function teamKey(name: string): string {
  return standardizeTeamName(name).trim().toLowerCase();
}

/**
 * Canonical 1X2 / HT side: home | draw | away.
 * Maps team names, "Home"/"Away", "1"/"X"/"2".
 */
export function canonicalizeMatchOutcome(
  prediction: string,
  homeTeam?: string,
  awayTeam?: string
): "home" | "draw" | "away" | null {
  const p = prediction.trim().toLowerCase().replace(/\s+/g, " ");
  if (!p) return null;
  if (p === "draw" || p === "x" || p === "tie" || p === "1x2 draw") {
    return "draw";
  }
  if (p === "home" || p === "1" || p === "home win" || p === "1x2 home") {
    return "home";
  }
  if (p === "away" || p === "2" || p === "away win" || p === "1x2 away") {
    return "away";
  }
  if (homeTeam && teamKey(prediction) === teamKey(homeTeam)) return "home";
  if (awayTeam && teamKey(prediction) === teamKey(awayTeam)) return "away";
  return null;
}

/** Canonical HSH / half-goals side. */
export function canonicalizeHalfOutcome(
  prediction: string
): "1h" | "2h" | "tie" | null {
  const p = prediction.trim().toLowerCase();
  if (!p) return null;
  if (/\btie\b|\bequal\b|\bdraw\b/.test(p)) return "tie";
  if (/^1h\b|1st half|first half|1h more/.test(p) || p === "1h") return "1h";
  if (/^2h\b|2nd half|second half|2h more/.test(p) || p === "2h") return "2h";
  return null;
}

/** Normalize side labels so Reco "Over 2.5" and League "over" can merge. */
export function normalizePredictionToken(
  prediction: string,
  opts?: { marketKey?: string; homeTeam?: string; awayTeam?: string }
): string {
  const p = prediction.trim().toLowerCase().replace(/\s+/g, " ");
  if (p === "yes" || p === "btts yes") return "yes";
  if (p === "no" || p === "btts no") return "no";
  if (/^over(?:\s+[\d.]+)?$/.test(p)) return "over";
  if (/^under(?:\s+[\d.]+)?$/.test(p)) return "under";

  const key = opts?.marketKey?.toLowerCase();
  if (key === "1x2" || key === "ht_1x2" || key === "three_way_handicap") {
    const side = canonicalizeMatchOutcome(prediction, opts?.homeTeam, opts?.awayTeam);
    if (side) return side;
  }
  if (key === "hsh" || key === "more_goals_half") {
    const half = canonicalizeHalfOutcome(prediction);
    if (half) return half;
  }
  return p;
}

export function isBinaryMarketKey(marketKey: string): boolean {
  const key = marketKey.toLowerCase();
  if (BINARY_OU_KEYS.has(key)) return true;
  if (EXCLUSIVE_OUTCOME_KEYS.has(key)) return true;
  if (key === "btts") return true;
  if (key.endsWith("_ou") || key.includes("_ou_")) return true;
  return false;
}

/**
 * Group key for mutually exclusive markets.
 * All 1X2 sides share one group so Home 82% and Away 82% cannot both top-3.
 */
export function binaryMarketGroupKey(m: {
  marketKey: string;
  line?: number;
}): string | null {
  const key = m.marketKey.toLowerCase();
  if (EXCLUSIVE_OUTCOME_KEYS.has(key)) {
    return `${key}::excl`;
  }
  if (!isBinaryMarketKey(m.marketKey)) return null;
  const line = m.line != null && Number.isFinite(m.line) ? String(m.line) : "";
  return `${key}::${line}`;
}

export function marketIdentity(
  m: {
    marketKey: string;
    prediction: string;
    line?: number;
  },
  opts?: { homeTeam?: string; awayTeam?: string }
): string {
  const line = m.line != null && Number.isFinite(m.line) ? String(m.line) : "";
  const pred = normalizePredictionToken(m.prediction, {
    marketKey: m.marketKey,
    homeTeam: opts?.homeTeam,
    awayTeam: opts?.awayTeam,
  });
  return `${m.marketKey}::${pred}::${line}`.toLowerCase();
}
