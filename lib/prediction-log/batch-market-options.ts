import { enabledComboMarkets } from "./combo-markets-config";
import {
  LOG_MARKET_MAP,
  LOG_MARKETS,
  pickOptionsForMarket,
} from "./markets-config";
import { setSingleMarket } from "./match-entry-helpers";
import type { ComboMarketDef } from "./types";
import type { CombinedOddsSettings, LogMarketKey, LogMatch } from "./types";

export type MarketOption =
  | {
      kind: "single";
      key: LogMarketKey;
      prediction: string;
      line?: number;
      label: string;
      value: string;
    }
  | { kind: "combo"; comboId: string; label: string; value: string };

function optionValue(
  kind: "single" | "combo",
  keyOrId: string,
  prediction?: string,
  line?: number
): string {
  if (kind === "combo") return `combo:${keyOrId}`;
  const linePart = line != null ? `:${line}` : "";
  return `single:${keyOrId}:${prediction}${linePart}`;
}

export function buildMarketOptions(
  homeTeam: string,
  awayTeam: string,
  comboSettings: CombinedOddsSettings,
  showSingle = true,
  showCombined = true
): MarketOption[] {
  const options: MarketOption[] = [];

  if (showSingle) {
    for (const def of LOG_MARKETS) {
      if (def.kind === "numeric" && def.lineOptions) {
        for (const line of def.lineOptions) {
          for (const pick of pickOptionsForMarket(def.key, homeTeam, awayTeam, line)) {
            options.push({
              kind: "single",
              key: def.key,
              prediction: pick.value,
              line,
              label: `${def.label} — ${pick.label}`,
              value: optionValue("single", def.key, pick.value, line),
            });
          }
        }
      } else {
        const line = def.defaultLine;
        for (const pick of pickOptionsForMarket(def.key, homeTeam, awayTeam, line)) {
          options.push({
            kind: "single",
            key: def.key,
            prediction: pick.value,
            line,
            label: `${def.label} — ${pick.label}`,
            value: optionValue("single", def.key, pick.value, line),
          });
        }
      }
    }
  }

  if (showCombined) {
    for (const combo of enabledComboMarkets(comboSettings.markets)) {
      options.push({
        kind: "combo",
        comboId: combo.id,
        label: combo.label,
        value: optionValue("combo", combo.id),
      });
    }
  }

  return options;
}

export function marketOptionFromMatch(
  match: LogMatch,
  homeTeam: string,
  awayTeam: string
): string {
  if (match.marketMode === "combined" && match.comboPick?.comboId) {
    return optionValue("combo", match.comboPick.comboId);
  }
  const keys = Object.keys(match.predictions) as LogMarketKey[];
  if (keys.length !== 1) return "";
  const key = keys[0]!;
  const pred = match.predictions[key];
  if (!pred?.prediction) return "";
  return optionValue("single", key, pred.prediction, pred.line);
}

export function applyMarketOption(match: LogMatch, option: MarketOption): LogMatch {
  if (option.kind === "combo") {
    return {
      ...match,
      marketMode: "combined",
      predictions: {},
      comboPick: {
        comboId: option.comboId,
        odds: match.comboPick?.odds ?? 0,
      },
    };
  }

  let next = setSingleMarket(match, option.key);
  const def = LOG_MARKET_MAP[option.key];
  next = {
    ...next,
    predictions: {
      [option.key]: {
        prediction: option.prediction,
        line: option.line ?? def.defaultLine,
        confidence: 50,
        odds: next.predictions[option.key]?.odds,
      },
    },
  };
  return next;
}

export function findMarketOption(
  options: MarketOption[],
  value: string
): MarketOption | undefined {
  return options.find((o) => o.value === value);
}

export function comboDefFromOption(option: MarketOption): ComboMarketDef | null {
  if (option.kind !== "combo") return null;
  return enabledComboMarkets([]).find((c) => c.id === option.comboId) ?? null;
}
