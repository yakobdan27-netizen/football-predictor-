/**
 * Map bet coupon (1xbet-style) selections into Prediction Log batch legs.
 */
import { DEFAULT_COMBO_MARKETS } from "./combo-markets-config";
import type { LogMarketKey, LogMatch } from "./types";

export type BetMarketPick = {
  marketType: string;
  selectionLabel: string;
};

export type LogMarketMapping =
  | {
      mode: "single";
      marketKey: LogMarketKey;
      prediction: string;
      line?: number;
    }
  | { mode: "combined"; comboId: string };

function parseOuLine(marketType: string): number | null {
  const m = /^OU_(\d)_(\d)$/.exec(marketType);
  if (!m) return null;
  return parseFloat(`${m[1]}.${m[2]}`);
}

function mapResultBtts(selectionLabel: string): string | null {
  const map: Record<string, string> = {
    "Home/Yes": "home_btts_yes",
    "Home/No": "home_btts_no",
    "Draw/Yes": "draw_btts_yes",
    "Away/Yes": "away_btts_yes",
    "Away/No": "away_btts_no",
  };
  return map[selectionLabel] ?? null;
}

function mapResultOu25(selectionLabel: string): string | null {
  const map: Record<string, string> = {
    "Home/Over": "home_over_2_5",
    "Away/Over": "away_over_2_5",
    "Draw/Under": "draw_under_2_5",
  };
  return map[selectionLabel] ?? null;
}

/** Map bet coupon outcome to Prediction Log single/combo leg. */
export function mapBetMarketToLog(pick: BetMarketPick): LogMarketMapping | null {
  const { marketType, selectionLabel } = pick;

  if (marketType === "1X2") {
    const pred =
      selectionLabel === "Home"
        ? "home"
        : selectionLabel === "Draw"
          ? "draw"
          : selectionLabel === "Away"
            ? "away"
            : null;
    return pred ? { mode: "single", marketKey: "1x2", prediction: pred } : null;
  }

  if (marketType === "DC") {
    const pred =
      selectionLabel === "1X"
        ? "1x"
        : selectionLabel === "12"
          ? "12"
          : selectionLabel === "X2"
            ? "x2"
            : null;
    return pred ? { mode: "single", marketKey: "double_chance", prediction: pred } : null;
  }

  if (marketType === "DNB") return null;

  if (marketType.startsWith("OU_")) {
    const line = parseOuLine(marketType);
    if (line == null) return null;
    const pred =
      selectionLabel === "Over"
        ? "over"
        : selectionLabel === "Under"
          ? "under"
          : null;
    return pred
      ? { mode: "single", marketKey: "total_goals_ou", prediction: pred, line }
      : null;
  }

  if (marketType === "BTTS") {
    const pred =
      selectionLabel === "Yes" ? "yes" : selectionLabel === "No" ? "no" : null;
    return pred ? { mode: "single", marketKey: "btts", prediction: pred } : null;
  }

  if (marketType === "1H_1X2") {
    const pred =
      selectionLabel === "Home"
        ? "home"
        : selectionLabel === "Draw"
          ? "draw"
          : selectionLabel === "Away"
            ? "away"
            : null;
    return pred ? { mode: "single", marketKey: "ht_1x2", prediction: pred } : null;
  }

  if (marketType.startsWith("1H_OU_") || marketType.startsWith("2H_OU_")) {
    return null;
  }

  if (marketType === "HALF_MOST_GOALS") {
    const pred =
      selectionLabel === "1H"
        ? "first_half"
        : selectionLabel === "2H"
          ? "second_half"
          : selectionLabel === "Equal"
            ? "equal"
            : null;
    return pred
      ? { mode: "single", marketKey: "more_goals_half", prediction: pred }
      : null;
  }

  if (marketType === "RESULT_BTTS") {
    const comboId = mapResultBtts(selectionLabel);
    return comboId ? { mode: "combined", comboId } : null;
  }

  if (marketType === "RESULT_OU_2_5") {
    const comboId = mapResultOu25(selectionLabel);
    return comboId ? { mode: "combined", comboId } : null;
  }

  return null;
}

export function isBetPickMappable(pick: BetMarketPick): boolean {
  return mapBetMarketToLog(pick) != null;
}

export function betPickDisplayLabel(pick: BetMarketPick): string {
  const mapped = mapBetMarketToLog(pick);
  if (mapped?.mode === "combined") {
    const def = DEFAULT_COMBO_MARKETS.find((c) => c.id === mapped.comboId);
    return def?.label ?? `${pick.marketType} ${pick.selectionLabel}`;
  }
  if (mapped?.mode === "single") {
    const line =
      mapped.line != null ? ` ${mapped.prediction} ${mapped.line}` : ` ${mapped.prediction}`;
    return `${mapped.marketKey}${line}`.trim();
  }
  return `${pick.marketType} · ${pick.selectionLabel}`;
}

/** Apply a bet coupon selection onto a LogMatch (fixture metadata preserved). */
export function applyBetPickToLogMatch(
  match: LogMatch,
  pick: BetMarketPick,
  odd: number | null
): { match: LogMatch; mapping: LogMarketMapping | null } {
  const mapping = mapBetMarketToLog(pick);
  if (!mapping) return { match, mapping: null };

  const odds = odd ?? undefined;

  if (mapping.mode === "combined") {
    return {
      mapping,
      match: {
        ...match,
        marketMode: "combined",
        predictions: {},
        comboPick: {
          comboId: mapping.comboId,
          odds: odds ?? 0,
        },
      },
    };
  }

  return {
    mapping,
    match: {
      ...match,
      marketMode: "single",
      comboPick: undefined,
      predictions: {
        [mapping.marketKey]: {
          prediction: mapping.prediction,
          confidence: 50,
          odds,
          line: mapping.line,
        },
      },
    },
  };
}
