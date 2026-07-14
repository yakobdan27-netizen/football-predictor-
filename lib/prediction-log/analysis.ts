import { LOG_MARKETS } from "./markets-config";
import { computeOddsAnalysis } from "./odds-analysis";
import { isValidOdds } from "./odds-bands";
import { scoreMatch } from "./scoring";import type {
  AnalysisHistory,
  LogMarketKey,
  MarketAccuracyStats,
  MarketRank,
  PredictionBatch,
  ScoredRow,
  ScoreResult,
} from "./types";
import { SCHEMA_VERSION } from "./types";
import { matchLeague } from "./match-league";

function emptyStats(): MarketAccuracyStats {
  return { correct: 0, wrong: 0, push: 0, pct: null };
}

function addResult(stats: MarketAccuracyStats, result: ScoreResult): void {
  if (result === "correct") stats.correct++;
  else if (result === "wrong") stats.wrong++;
  else if (result === "push") stats.push++;
  // void excluded from accuracy (same as pending)
}

function finalizePct(stats: MarketAccuracyStats): void {
  const denom = stats.correct + stats.wrong;
  stats.pct = denom > 0 ? Math.round((stats.correct / denom) * 100) : null;
}

export function flattenScoredRows(batches: PredictionBatch[]): ScoredRow[] {
  const rows: ScoredRow[] = [];
  for (const batch of batches) {
    for (const match of batch.matches) {
      const scored = scoreMatch(match);
      for (const [key, pred] of Object.entries(scored.predictions) as [
        LogMarketKey,
        { prediction: string; line?: number; confidence: number; odds?: number },
      ][]) {
        const result = scored.scored[key];
        if (result == null || result === "void") continue;
        const actual = scored.actualResults[key]?.actual;
        if (actual == null) continue;
        rows.push({
          batchId: batch.id,
          batchName: batch.batchName,
          league: matchLeague(match, batch.league),
          date: batch.date,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          market: key,
          prediction: pred.prediction,
          line: pred.line,
          confidence: pred.confidence,
          odds: isValidOdds(pred.odds) ? pred.odds : undefined,
          actual,
          result,
        });      }
    }
  }
  return rows.sort((a, b) => `${b.date}${b.batchId}`.localeCompare(`${a.date}${a.batchId}`));
}

function statsFromRows(rows: ScoredRow[]): MarketAccuracyStats {
  const stats = emptyStats();
  for (const r of rows) {
    if (r.result === "correct" || r.result === "wrong" || r.result === "push") {
      addResult(stats, r.result);
    }
  }
  finalizePct(stats);
  return stats;
}

function rankMarkets(
  marketAccuracy: Partial<Record<LogMarketKey, MarketAccuracyStats>>,
  ascending: boolean
): MarketRank[] {
  const labelMap = Object.fromEntries(LOG_MARKETS.map((m) => [m.key, m.label]));
  const ranks: MarketRank[] = [];
  for (const [key, stats] of Object.entries(marketAccuracy) as [
    LogMarketKey,
    MarketAccuracyStats,
  ][]) {
    const total = stats.correct + stats.wrong;
    if (total < 3 || stats.pct == null) continue;
    ranks.push({
      market: key,
      label: labelMap[key] ?? key,
      pct: stats.pct,
      total,
    });
  }
  ranks.sort((a, b) => (ascending ? a.pct - b.pct : b.pct - a.pct));
  return ranks.slice(0, 5);
}

export function recomputeAnalysis(batches: PredictionBatch[]): AnalysisHistory {
  const allRows = flattenScoredRows(batches);
  const countable = allRows.filter((r) => r.result === "correct" || r.result === "wrong");

  const marketAccuracy: Partial<Record<LogMarketKey, MarketAccuracyStats>> = {};
  for (const m of LOG_MARKETS) {
    const rows = allRows.filter((r) => r.market === m.key);
    if (rows.length === 0) continue;
    marketAccuracy[m.key] = statsFromRows(rows);
  }

  const leagueAccuracy: Record<string, Partial<Record<LogMarketKey, MarketAccuracyStats>>> =
    {};
  for (const league of [...new Set(allRows.map((r) => r.league))]) {
    leagueAccuracy[league] = {};
    for (const m of LOG_MARKETS) {
      const rows = allRows.filter((r) => r.league === league && r.market === m.key);
      if (rows.length === 0) continue;
      leagueAccuracy[league][m.key] = statsFromRows(rows);
    }
  }

  const highConfRows = countable.filter((r) => r.confidence > 70);
  const recentRows = countable.slice(0, 20);
  const highConfidenceAccuracy = statsFromRows(highConfRows);
  const recentForm = statsFromRows(recentRows);

  const topMarkets = rankMarkets(marketAccuracy, false);
  const weakestMarkets = rankMarkets(marketAccuracy, true);

  let calibrationNote = "Enter results on saved batches to build your personal accuracy profile.";
  if (countable.length > 0) {
    const overall = statsFromRows(countable);
    const overallPct = overall.pct ?? 0;
    const hiPct = highConfidenceAccuracy.pct;
    if (hiPct != null && overall.pct != null) {
      calibrationNote =
        hiPct >= overallPct
          ? `High-confidence picks (>${70}%) hit ${hiPct}% vs ${overallPct}% overall — trust your strong reads.`
          : `High-confidence picks (>${70}%) hit ${hiPct}% vs ${overallPct}% overall — consider lowering confidence on weaker markets.`;
    } else {
      calibrationNote = `Overall accuracy across ${countable.length} scored picks: ${overallPct}%.`;
    }
  }

  const oddsAnalysis = computeOddsAnalysis(allRows);

  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    totalScored: countable.length,
    marketAccuracy,
    leagueAccuracy,
    highConfidenceAccuracy,
    recentForm,
    topMarkets,
    weakestMarkets,
    calibrationNote,
    oddsAnalysis,
  };
}