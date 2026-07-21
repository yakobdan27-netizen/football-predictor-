/**
 * Map combo market ids to related LogMarketKey(s) for top-3 overlap exclusion.
 */
import type { ComboCandidate } from "../combo-selection";
import { pickBestCombo } from "../combo-selection";
import type { LogMarketKey } from "../types";

const GOAL_KEYS: LogMarketKey[] = [
  "total_goals_ou",
  "home_goals_ou",
  "away_goals_ou",
];

/** Related single-market keys a combo id touches. */
export function relatedMarketKeysForCombo(comboId: string): LogMarketKey[] {
  const id = comboId.toLowerCase();
  const keys = new Set<LogMarketKey>();

  if (
    id.startsWith("home_") ||
    id.startsWith("away_") ||
    id.startsWith("draw_") ||
    id.includes("_ht_") ||
    id.includes("ht_")
  ) {
    keys.add("1x2");
  }
  if (id.startsWith("1x_") || id.startsWith("x2_") || id.startsWith("12_")) {
    keys.add("double_chance");
    keys.add("1x2");
  }
  if (id.includes("btts")) {
    keys.add("btts");
  }
  if (
    id.includes("over_") ||
    id.includes("under_") ||
    id.includes("_goals") ||
    /_\d_\d_goals/.test(id) ||
    id.includes("2_3_goals") ||
    id.includes("0_2_goals")
  ) {
    for (const k of GOAL_KEYS) keys.add(k);
  }
  if (id.includes("corner")) {
    keys.add("corners_ou");
  }
  if (id.includes("half") || id.includes("_ht") || id.includes("ht_")) {
    keys.add("ht_1x2");
    keys.add("more_goals_half");
  }

  return [...keys];
}

export function comboOverlapsTopThree(
  comboId: string,
  topThreeMarketKeys: Iterable<string>
): boolean {
  const top = new Set([...topThreeMarketKeys].map((k) => k.toLowerCase()));
  if (top.size === 0) return false;
  const related = relatedMarketKeysForCombo(comboId);
  return related.some((k) => top.has(k.toLowerCase()));
}

/**
 * Prefer strongest combo that does not overlap top-3 markets.
 * Fallback: absolute strongest (mandatory — never blank when candidates exist).
 */
export function pickMandatoryCombo(
  evaluated: ComboCandidate[],
  topThreeMarketKeys: Iterable<string>
): ComboCandidate | null {
  if (evaluated.length === 0) return null;
  const nonOverlap = evaluated.filter(
    (c) => !comboOverlapsTopThree(c.comboId, topThreeMarketKeys)
  );
  return pickBestCombo(nonOverlap.length > 0 ? nonOverlap : evaluated);
}
