import { gradeMatchFromFacts } from "./grade-from-facts";
import { scoreMarket } from "./score-market";
import type {
  LogMarketKey,
  LogMatch,
  MarketPrediction,
  PredictionBatch,
  RecommendedBatch,
  RecommendedPick,
  ScoreResult,
} from "./types";

export { scoreMarket } from "./score-market";

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
    const r = scoreMarket(key, pred.prediction, pred.line, actual);
    scored[key] = r == null ? "void" : r;
  }
  return scored;
}

export function scoreMatch(match: LogMatch): LogMatch {
  return gradeMatchFromFacts(match);
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
  const alt =
    recommended?.mathSnapshot?.betterAlternativeByMatch?.[match.id] ?? null;
  const scored = gradeMatchFromFacts(match, { betterAlternative: alt });
  const recPreds = recommendedPredictionsFromBatch(match, recommended);
  if (!recPreds || Object.keys(recPreds).length === 0) {
    return scored;
  }
  return {
    ...scored,
    recommendedScored: scoreMatchPredictions(scored, recPreds),
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
    const primary = m.primaryGrade?.result;
    if (primary === "correct" || primary === "wrong") {
      total++;
      if (primary === "correct") scored++;
      continue;
    }
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
    const primary = m.primaryGrade?.result;
    if (primary != null) {
      total++;
      if (
        primary === "correct" ||
        primary === "wrong" ||
        primary === "push" ||
        primary === "void"
      ) {
        scored++;
      }
      continue;
    }
    for (const r of Object.values(m.scored)) {
      if (r != null) total++;
      if (r === "correct" || r === "wrong" || r === "push" || r === "void") scored++;
    }
  }
  return { scored, total };
}
