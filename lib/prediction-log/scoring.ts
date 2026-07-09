import { LOG_MARKET_MAP } from "./markets-config";
import type {
  LogMarketKey,
  LogMatch,
  MarketPrediction,
  PredictionBatch,
  RecommendedBatch,
  RecommendedPick,
  ScoreResult,
} from "./types";

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

export function scoreMatchPredictions(
  match: LogMatch,
  predictions: Partial<Record<LogMarketKey, MarketPrediction>>
): Partial<Record<LogMarketKey, ScoreResult>> {
  const scored: Partial<Record<LogMarketKey, ScoreResult>> = {};
  for (const [key, pred] of Object.entries(predictions) as [
    LogMarketKey,
    MarketPrediction,
  ][]) {
    const actual = match.actualResults[key]?.actual;
    scored[key] = scoreMarket(key, pred.prediction, pred.line, actual);
  }
  return scored;
}

export function scoreMatch(match: LogMatch): LogMatch {
  const scored = scoreMatchPredictions(match, match.predictions);
  return { ...match, scored };
}

function recommendedPredictionsFromBatch(
  match: LogMatch,
  recommended?: RecommendedBatch
): Partial<Record<LogMarketKey, MarketPrediction>> | null {
  if (!recommended) return null;
  const rm = recommended.matches.find((m) => m.id === match.id);
  if (!rm) return null;
  const preds: Partial<Record<LogMarketKey, MarketPrediction>> = {};
  for (const [key, rp] of Object.entries(rm.predictions) as [LogMarketKey, RecommendedPick][]) {
    if (rp.action === "remove") continue;
    preds[key] = {
      prediction: rp.prediction,
      line: rp.line,
      confidence: rp.confidence,
      odds: rp.odds,
    };
  }
  return preds;
}

export function scoreMatchWithRecommended(
  match: LogMatch,
  recommended?: RecommendedBatch
): LogMatch {
  const scored = scoreMatch(match);
  const recPreds = recommendedPredictionsFromBatch(match, recommended);
  if (!recPreds || Object.keys(recPreds).length === 0) {
    return scored;
  }
  return {
    ...scored,
    recommendedScored: scoreMatchPredictions(match, recPreds),
  };
}

export function scoreBatch(batch: PredictionBatch): PredictionBatch {
  return {
    ...batch,
    matches: batch.matches.map((m) => scoreMatchWithRecommended(m, batch.recommended)),
  };
}

export function batchScoredPct(batch: PredictionBatch): number | null {
  let scored = 0;
  let total = 0;
  for (const m of batch.matches) {
    for (const r of Object.values(m.scored)) {
      if (r === "correct" || r === "wrong") {
        total++;
        if (r === "correct") scored++;
      }
    }
  }
  if (total === 0) return null;
  return Math.round((scored / total) * 100);
}

export function marketsEnteredCount(batch: PredictionBatch): {
  scored: number;
  total: number;
} {
  let scored = 0;
  let total = 0;
  for (const m of batch.matches) {
    for (const r of Object.values(m.scored)) {
      if (r != null) total++;
      if (r === "correct" || r === "wrong" || r === "push") scored++;
    }
  }
  return { scored, total };
}
