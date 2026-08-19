import type { LogMarketKey } from "@/lib/prediction-log/types";
import {
  enumerateFamilySelections,
  FAMILY_LABELS,
} from "@/lib/slip-builder/families";
import { DEFAULT_COMBO_MARKETS } from "@/lib/prediction-log/combo-markets-config";
import { MARKET_FAMILY_IDS, type MarketFamilyId } from "@/lib/slip-builder/types";
import { msamConflictGroupOf } from "./conflict-groups";
import type { MarketCode } from "./types";

export type CatalogEntry = {
  marketCode: MarketCode;
  marketFamily: MarketFamilyId;
  conflictGroup: ReturnType<typeof msamConflictGroupOf>;
  selectionKey: string;
  selectionLabel: string;
  line?: number;
  comboId?: string;
};

export function buildMarketCode(
  family: MarketFamilyId,
  selectionKey: string,
  line?: number,
  comboId?: string
): MarketCode {
  if (comboId) return `${family}:${comboId}`;
  if (line != null) return `${family}:${selectionKey}:${line}`;
  return `${family}:${selectionKey}`;
}

/** Full MSAM proposition catalog from slip-builder families. */
export function enumerateMsamCatalog(): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const family of MARKET_FAMILY_IDS) {
    if (family === "COMBO") {
      for (const combo of DEFAULT_COMBO_MARKETS) {
        out.push({
          marketCode: buildMarketCode(family, combo.id, undefined, combo.id),
          marketFamily: family,
          conflictGroup: msamConflictGroupOf(family),
          selectionKey: combo.id,
          selectionLabel: combo.label,
          comboId: combo.id,
        });
      }
      continue;
    }
    for (const sel of enumerateFamilySelections(family)) {
      out.push({
        marketCode: buildMarketCode(family, sel.selectionKey, sel.line),
        marketFamily: family,
        conflictGroup: msamConflictGroupOf(family),
        selectionKey: sel.selectionKey,
        selectionLabel: sel.selectionLabel,
        line: sel.line,
      });
    }
  }
  return out;
}

export function marketLabelFromCatalog(entry: CatalogEntry): string {
  return FAMILY_LABELS[entry.marketFamily];
}

/** Map Decision Maker LogMarketKey to primary MarketFamilyId. */
export const LOG_KEY_TO_FAMILY: Partial<Record<LogMarketKey, MarketFamilyId>> = {
  "1x2": "RESULT_1X2",
  double_chance: "DOUBLE_CHANCE",
  btts: "BTTS",
  total_goals_ou: "TOTALS",
  home_goals_ou: "TEAM_GOALS",
  away_goals_ou: "TEAM_GOALS",
  handicap: "HANDICAP",
  ht_1x2: "HT_RESULT",
  more_goals_half: "HSH",
  draw_one_half: "DIEH",
  win_one_half: "WIN_ONE_HALF",
  corners_ou: "CORNERS",
  home_corners_ou: "CORNERS",
  sot_ou: "SOT",
  home_sot_ou: "SOT",
  away_sot_ou: "SOT",
};

export function parseDmMarketToCode(
  marketKey: string,
  prediction: string,
  line?: number
): MarketCode | null {
  const family = LOG_KEY_TO_FAMILY[marketKey as LogMarketKey];
  if (!family) return null;
  const pred = prediction.trim().toLowerCase();
  if (family === "RESULT_1X2") {
    const sk =
      pred.includes("home") || pred === "1"
        ? "home"
        : pred.includes("draw") || pred === "x"
          ? "draw"
          : pred.includes("away") || pred === "2"
            ? "away"
            : null;
    if (!sk) return null;
    return buildMarketCode(family, sk);
  }
  if (family === "BTTS") {
    const sk = pred.includes("no") ? "no" : pred.includes("yes") ? "yes" : null;
    if (!sk) return null;
    return buildMarketCode(family, sk);
  }
  if (family === "TOTALS" && line != null) {
    const sk = pred.includes("under") ? `under_${line}` : `over_${line}`;
    return buildMarketCode(family, sk, line);
  }
  if (family === "DIEH") {
    const sk = pred.includes("no") ? "no" : "yes";
    return buildMarketCode(family, sk);
  }
  if (family === "HSH") {
    const sk = pred.includes("2") ? "2h" : pred.includes("1") ? "1h" : "tie";
    return buildMarketCode(family, sk);
  }
  if (family === "CORNERS" && line != null) {
    const sk = pred.includes("under") ? `under_${line}` : `over_${line}`;
    return buildMarketCode(family, sk, line);
  }
  return buildMarketCode(family, pred.replace(/\s+/g, "_"), line);
}
