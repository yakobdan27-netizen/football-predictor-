import { LOG_MARKET_MAP } from "./markets-config";
import { isValidOdds } from "./odds-bands";
import type { LogMarketKey, LogMatch, PredictionBatch, ScoreResult } from "./types";

export interface BatchLegResult {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  market: LogMarketKey;
  marketLabel: string;
  prediction: string;
  odds: number | null;
  result: ScoreResult;
}

export interface BatchAnalysisRow {
  batchId: string;
  batchName: string;
  date: string;
  league: string;
  matchCount: number;
  legsScored: number;
  legsCorrect: number;
  legsWrong: number;
  batchWon: boolean | null;
  /** First wrong leg that broke an otherwise winning accumulator. */
  breakingLeg: BatchLegResult | null;
  legs: BatchLegResult[];
}

function primaryLegForMatch(match: LogMatch): BatchLegResult | null {
  let best: BatchLegResult | null = null;
  for (const [key, pred] of Object.entries(match.predictions) as [
    LogMarketKey,
    { prediction: string; odds?: number },
  ][]) {
    const result = match.scored[key];
    if (result == null) continue;
    const odds = isValidOdds(pred.odds) ? pred.odds! : null;
    const leg: BatchLegResult = {
      matchId: match.id,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      market: key,
      marketLabel: LOG_MARKET_MAP[key]?.label ?? key,
      prediction: pred.prediction,
      odds,
      result,
    };
    if (!best || (odds != null && (best.odds == null || odds < best.odds))) {
      best = leg;
    }
  }
  return best;
}

export function analyzeBatch(batch: PredictionBatch): BatchAnalysisRow {
  const legs: BatchLegResult[] = [];
  for (const match of batch.matches) {
    const leg = primaryLegForMatch(match);
    if (leg) legs.push(leg);
  }

  const scored = legs.filter((l) => l.result === "correct" || l.result === "wrong");
  const legsCorrect = scored.filter((l) => l.result === "correct").length;
  const legsWrong = scored.filter((l) => l.result === "wrong").length;

  let batchWon: boolean | null = null;
  let breakingLeg: BatchLegResult | null = null;

  if (scored.length > 0) {
    batchWon = legsWrong === 0;
    if (!batchWon) {
      breakingLeg = scored.find((l) => l.result === "wrong") ?? null;
    }
  }

  return {
    batchId: batch.id,
    batchName: batch.batchName,
    date: batch.date,
    league: batch.league,
    matchCount: batch.matches.length,
    legsScored: scored.length,
    legsCorrect,
    legsWrong,
    batchWon,
    breakingLeg,
    legs,
  };
}

export function analyzeAllBatches(batches: PredictionBatch[]): BatchAnalysisRow[] {
  return batches
    .map(analyzeBatch)
    .filter((b) => b.legsScored > 0)
    .sort((a, b) => `${b.date}${b.batchId}`.localeCompare(`${a.date}${a.batchId}`));
}
