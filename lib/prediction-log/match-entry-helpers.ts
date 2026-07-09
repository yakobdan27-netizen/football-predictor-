import { LOG_MARKETS } from "./markets-config";
import { DEFAULT_COMBO_MARKETS } from "./combo-markets-config";
import type { LogMarketKey, LogMatch, MarketMode } from "./types";

export function resolveMarketMode(match: LogMatch): MarketMode {
  if (match.marketMode) return match.marketMode;
  if (match.comboPick?.comboId) return "combined";
  return "single";
}

export function singleMarketKey(match: LogMatch): LogMarketKey | null {
  const keys = Object.keys(match.predictions) as LogMarketKey[];
  return keys[0] ?? null;
}

export function switchMarketMode(match: LogMatch, mode: MarketMode): LogMatch {
  if (mode === "combined") {
    return {
      ...match,
      marketMode: "combined",
      predictions: {},
      comboPick: match.comboPick?.comboId
        ? match.comboPick
        : { comboId: "", odds: 0 },
    };
  }
  return {
    ...match,
    marketMode: "single",
    comboPick: undefined,
    predictions: match.predictions,
  };
}

export function setSingleMarket(match: LogMatch, key: LogMarketKey): LogMatch {
  const existing = match.predictions[key];
  return {
    ...match,
    marketMode: "single",
    comboPick: undefined,
    predictions: existing ? { [key]: existing } : { [key]: { prediction: "", confidence: 50 } },
  };
}

export function validateMatchLeg(match: LogMatch): string | null {
  const mode = resolveMarketMode(match);
  if (mode === "combined") {
    if (!match.comboPick?.comboId) return "Select a combo market.";
    if (match.comboPick.odds == null || !Number.isFinite(match.comboPick.odds)) {
      return "Enter combined odds.";
    }
    return null;
  }
  const keys = Object.keys(match.predictions) as LogMarketKey[];
  if (keys.length === 0) return "Select a market.";
  if (keys.length > 1) return "Only one single market allowed per match.";
  const pred = match.predictions[keys[0]!];
  if (!pred?.prediction) return "Select a prediction.";
  return null;
}

export function matchLegLabel(match: LogMatch): string {
  const mode = resolveMarketMode(match);
  if (mode === "combined" && match.comboPick?.comboId) {
    const combo = DEFAULT_COMBO_MARKETS.find((c) => c.id === match.comboPick!.comboId);
    return combo?.label ?? match.comboPick.comboId.replace(/_/g, " ");
  }
  const key = singleMarketKey(match);
  if (!key) return "—";
  const def = LOG_MARKETS.find((m) => m.key === key);
  const pred = match.predictions[key];
  return def ? `${def.label}: ${pred?.prediction ?? ""}` : key;
}

export function hydrateComboFromEntry(batch: import("./types").PredictionBatch): import("./types").PredictionBatch {
  const comboPickByMatch: Record<string, string> = {};
  const comboOddsByMatch: Record<string, number> = {};
  for (const m of batch.matches) {
    if (resolveMarketMode(m) === "combined" && m.comboPick?.comboId) {
      comboPickByMatch[m.id] = m.comboPick.comboId;
      if (m.comboPick.odds) comboOddsByMatch[m.id] = m.comboPick.odds;
    }
  }
  if (!batch.recommended || Object.keys(comboPickByMatch).length === 0) return batch;
  return {
    ...batch,
    recommended: {
      ...batch.recommended,
      comboPickByMatch: { ...batch.recommended.comboPickByMatch, ...comboPickByMatch },
      comboOddsByMatch: { ...batch.recommended.comboOddsByMatch, ...comboOddsByMatch },
    },
  };
}
