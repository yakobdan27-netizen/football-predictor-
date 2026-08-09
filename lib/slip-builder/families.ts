/**
 * Market family labels and selection enumerators for the slip builder.
 */
import { DEFAULT_COMBO_MARKETS } from "@/lib/prediction-log/combo-markets-config";
import { TOTAL_GOALS_LINES } from "@/lib/prediction-log/total-goals-markets";
import type { FamilySelectionDef, MarketFamilyId } from "./types";

export const FAMILY_LABELS: Record<MarketFamilyId, string> = {
  RESULT_1X2: "Match Result",
  DOUBLE_CHANCE: "Double Chance",
  HANDICAP: "Handicap",
  TOTALS: "Total Goals",
  TEAM_GOALS: "Team Goals",
  BTTS: "Both Teams To Score",
  HALF_GOALS: "Half Goals",
  HT_RESULT: "First-Half Result",
  DIEH: "Draw Either Half",
  CORNERS: "Corners",
  COMBO: "Combo",
};

export const DEFAULT_FOUR_FAMILIES: MarketFamilyId[] = [
  "RESULT_1X2",
  "TOTALS",
  "DIEH",
  "COMBO",
];

const HANDICAP_LINES = [-1.5, -1, -0.5, 0.5, 1, 1.5] as const;
const TEAM_GOAL_LINES = [0.5, 1.5, 2.5] as const;

function formatHandicap(line: number, side: "home" | "away"): string {
  const signed =
    side === "home"
      ? line > 0
        ? `+${line}`
        : String(line)
      : -line > 0
        ? `+${-line}`
        : String(-line);
  return `${side === "home" ? "Home" : "Away"} ${signed}`;
}

/** Enumerate candidate selections for a market family. */
export function enumerateFamilySelections(
  family: MarketFamilyId
): FamilySelectionDef[] {
  switch (family) {
    case "RESULT_1X2":
      return [
        { selectionKey: "home", selectionLabel: "Home Win" },
        { selectionKey: "draw", selectionLabel: "Draw" },
        { selectionKey: "away", selectionLabel: "Away Win" },
      ];
    case "DOUBLE_CHANCE":
      return [
        { selectionKey: "1X", selectionLabel: "1X (Home or Draw)" },
        { selectionKey: "X2", selectionLabel: "X2 (Away or Draw)" },
        { selectionKey: "12", selectionLabel: "12 (Home or Away)" },
      ];
    case "HANDICAP": {
      const out: FamilySelectionDef[] = [];
      for (const line of HANDICAP_LINES) {
        out.push({
          selectionKey: `home_${line}`,
          selectionLabel: formatHandicap(line, "home"),
          line,
        });
        out.push({
          selectionKey: `away_${line}`,
          selectionLabel: formatHandicap(line, "away"),
          line,
        });
      }
      return out;
    }
    case "TOTALS": {
      const out: FamilySelectionDef[] = [];
      for (const line of TOTAL_GOALS_LINES) {
        out.push({
          selectionKey: `over_${line}`,
          selectionLabel: `Over ${line}`,
          line,
        });
        out.push({
          selectionKey: `under_${line}`,
          selectionLabel: `Under ${line}`,
          line,
        });
      }
      return out;
    }
    case "TEAM_GOALS": {
      const out: FamilySelectionDef[] = [];
      for (const side of ["home", "away"] as const) {
        for (const line of TEAM_GOAL_LINES) {
          out.push({
            selectionKey: `${side}_over_${line}`,
            selectionLabel: `${side === "home" ? "Home" : "Away"} Over ${line}`,
            line,
          });
          out.push({
            selectionKey: `${side}_under_${line}`,
            selectionLabel: `${side === "home" ? "Home" : "Away"} Under ${line}`,
            line,
          });
        }
      }
      out.push({
        selectionKey: "home_cs",
        selectionLabel: "Home Clean Sheet",
      });
      out.push({
        selectionKey: "away_cs",
        selectionLabel: "Away Clean Sheet",
      });
      return out;
    }
    case "BTTS":
      return [
        { selectionKey: "yes", selectionLabel: "BTTS Yes" },
        { selectionKey: "no", selectionLabel: "BTTS No" },
      ];
    case "HALF_GOALS":
      return [
        {
          selectionKey: "2h_gt_1h",
          selectionLabel: "2H more goals than 1H",
        },
        { selectionKey: "1h_gt_2h", selectionLabel: "1H more goals than 2H" },
        { selectionKey: "tie", selectionLabel: "Halves tied" },
        {
          selectionKey: "home_1h_over_0_5",
          selectionLabel: "Home 1H Over 0.5",
          line: 0.5,
        },
        {
          selectionKey: "away_1h_over_0_5",
          selectionLabel: "Away 1H Over 0.5",
          line: 0.5,
        },
      ];
    case "HT_RESULT":
      return [
        { selectionKey: "ht_home", selectionLabel: "HT Home" },
        { selectionKey: "ht_draw", selectionLabel: "HT Draw" },
        { selectionKey: "ht_away", selectionLabel: "HT Away" },
        { selectionKey: "ht_1X", selectionLabel: "HT 1X" },
        { selectionKey: "ht_X2", selectionLabel: "HT X2" },
        { selectionKey: "ht_12", selectionLabel: "HT 12" },
      ];
    case "DIEH":
      return [
        { selectionKey: "yes", selectionLabel: "Draw Either Half — Yes" },
        { selectionKey: "no", selectionLabel: "Draw Either Half — No" },
      ];
    case "CORNERS":
      return [
        {
          selectionKey: "over_9_5",
          selectionLabel: "Total Corners Over 9.5",
          line: 9.5,
        },
        {
          selectionKey: "under_9_5",
          selectionLabel: "Total Corners Under 9.5",
          line: 9.5,
        },
      ];
    case "COMBO":
      return DEFAULT_COMBO_MARKETS.filter((c) => c.enabled).map((c) => ({
        selectionKey: c.id,
        selectionLabel: c.label,
        comboId: c.id,
      }));
    default: {
      const _exhaustive: never = family;
      return _exhaustive;
    }
  }
}
