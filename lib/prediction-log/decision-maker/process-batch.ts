import { LOG_MARKET_MAP, pickOptionsForMarket } from "../markets-config";
import { matchLeague } from "../match-league";
import { getBatchDisplayId } from "../snapshot-readers";
import type {
  AnalysisHistory,
  CombinedOddsSettings,
  LearnerStatsStore,
  LogMarketKey,
  PredictionBatch,
} from "../types";
import type { TeamsQualityStore } from "../teams-quality-types";
import { buildDecisionBatchCaches } from "./build-batch-caches";
import {
  aggregateMatchData,
  generateTopThreeMarkets,
} from "./decision-engine";
import { categoryForLogMarket } from "./market-category";
import { clampConfidence } from "./confidence";
import type { DecisionMarketCandidate, MatchDecisionRow } from "./types";

function fallbacksFromMatch(
  batch: PredictionBatch,
  match: PredictionBatch["matches"][number]
): DecisionMarketCandidate[] {
  const out: DecisionMarketCandidate[] = [];
  for (const [key, pred] of Object.entries(match.predictions)) {
    if (!pred?.prediction) continue;
    const marketKey = key as LogMarketKey;
    const def = LOG_MARKET_MAP[marketKey];
    if (!def) continue;
    const label =
      pickOptionsForMarket(
        marketKey,
        match.homeTeam,
        match.awayTeam,
        pred.line
      ).find((o) => o.value === pred.prediction)?.label ?? pred.prediction;
    out.push({
      marketKey,
      label: def.label,
      prediction: label,
      confidence: clampConfidence(pred.confidence ?? 50),
      category: categoryForLogMarket(marketKey),
      pageId: "prediction-log",
      pageLabel: "Prediction Log",
      line: pred.line,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

export function processBatchDecisions(params: {
  batch: PredictionBatch;
  allBatches: PredictionBatch[];
  comboSettings: CombinedOddsSettings;
  analysis: AnalysisHistory | null;
  teamsQuality: TeamsQualityStore | null;
  learnerStats: LearnerStatsStore | null;
}): MatchDecisionRow[] {
  const { batch, allBatches, comboSettings, analysis, teamsQuality, learnerStats } =
    params;

  const caches = buildDecisionBatchCaches({
    batch,
    allBatches,
    comboSettings,
    analysis,
    teamsQuality,
    learnerStats,
  });

  const batchDisplayId = getBatchDisplayId(batch);

  // Never drop matches — map every fixture in the batch
  return batch.matches.map((match) => {
    const ctx = {
      batch,
      match,
      allBatches,
      comboSettings,
      learnerStats,
      analysis,
      teamsQuality,
      caches,
    };
    const matchData = aggregateMatchData(ctx);
    const result = generateTopThreeMarkets(matchData, fallbacksFromMatch(batch, match));

    return {
      match,
      batchId: batch.id,
      batchDisplayId,
      league: matchLeague(match, batch.league),
      markets: result.markets,
      sourceCount: result.sourceCount,
      missingSources: result.missingSources,
      incomplete: result.incomplete,
    };
  });
}

export function processAllBatchesDecisions(params: {
  batches: PredictionBatch[];
  comboSettings: CombinedOddsSettings;
  analysis: AnalysisHistory | null;
  teamsQuality: TeamsQualityStore | null;
  learnerStats: LearnerStatsStore | null;
}): { batch: PredictionBatch; decisions: MatchDecisionRow[] }[] {
  const sorted = [...params.batches].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
  );

  return sorted.map((batch) => ({
    batch,
    decisions: processBatchDecisions({
      batch,
      allBatches: params.batches,
      comboSettings: params.comboSettings,
      analysis: params.analysis,
      teamsQuality: params.teamsQuality,
      learnerStats: params.learnerStats,
    }),
  }));
}
