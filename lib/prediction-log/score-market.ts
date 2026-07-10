import { LOG_MARKET_MAP } from "./markets-config";
import type { LogMarketKey, ScoreResult } from "./types";

function isBlankActual(actual: string | number | undefined | null): boolean {
  if (actual == null) return true;
  if (typeof actual === "string") return actual.trim() === "";
  return false;
}

function normalizeActual(value: string | number): string | number {
  if (typeof value === "number") return value;
  const v = value.trim().toLowerCase();
  const map: Record<string, string> = {
    home: "home",
    draw: "draw",
    away: "away",
    yes: "yes",
    no: "no",
    over: "over",
    under: "under",
    "1x": "1x",
    x2: "x2",
    "12": "12",
    "1st": "first_half",
    "1st half": "first_half",
    first_half: "first_half",
    "2nd": "second_half",
    "2nd half": "second_half",
    second_half: "second_half",
    equal: "equal",
  };
  return map[v] ?? v;
}

function scoreCategorical(
  prediction: string,
  actual: string | number
): ScoreResult {
  const a = normalizeActual(actual);
  const p = normalizeActual(prediction);
  if (typeof a === "number") return null;
  return p === a ? "correct" : "wrong";
}

function scoreNumeric(
  prediction: string,
  line: number | undefined,
  actual: string | number
): ScoreResult {
  if (line == null) return null;
  const raw =
    typeof actual === "number" ? actual : parseFloat(String(actual).trim());
  if (!Number.isFinite(raw)) return null;
  if (raw === line) return "push";
  const side = raw > line ? "over" : "under";
  const p = normalizeActual(prediction);
  if (typeof p === "number") return null;
  return p === side ? "correct" : "wrong";
}

export function scoreMarket(
  key: LogMarketKey,
  prediction: string,
  line: number | undefined,
  actual: string | number | undefined | null
): ScoreResult {
  if (isBlankActual(actual ?? undefined)) return null;
  const def = LOG_MARKET_MAP[key];
  if (def.kind === "categorical") {
    return scoreCategorical(prediction, actual as string | number);
  }
  return scoreNumeric(prediction, line, actual as string | number);
}
