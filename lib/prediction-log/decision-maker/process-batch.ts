import { LOG_MARKET_MAP, pickOptionsForMarket } from "../markets-config";
import { matchLeague } from "../match-league";
import { getBatchDisplayId, getSelectedPickForMatch } from "../snapshot-readers";
import type {
  AnalysisHistory,
  CombinedOddsSettings,
  LearnerStatsStore,
  LogMarketKey,
  PredictionBatch,
} from "../types";
import type { LeaguePriorsStore } from "../league-priors";
import type { TeamsQualityStore } from "../teams-quality-types";
import { buildDecisionBatchCaches } from "./build-batch-caches";
import { pickMandatoryCombo } from "./combo-exclude";
import {
  aggregateMatchData,
  generateTopThreeMarkets,
} from "./decision-engine";
import { categoryForLogMarket } from "./market-category";
import { clampConfidence } from "./confidence";
import type { DecisionMarketCandidate, MatchDecisionRow } from "./types";
import {
  buildUserMarketEvaluation,
  computeRowConfidenceScore,
} from "./user-market-evaluation";

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

/** System % for a user marketKey from recommendation snapshot or top-3. */
function systemPctForUserMarket(
  batch: PredictionBatch,
  matchId: string,
  marketKey: string,
  topThree: MatchDecisionRow["markets"]
): number | null {
  const inTop = topThree.find((m) => m.marketKey === marketKey);
  if (inTop) return inTop.confidence;

  const rm = batch.recommended?.matches.find((m) => m.id === matchId);
  if (rm) {
    const selected = getSelectedPickForMatch(rm);
    if (selected?.marketKey === marketKey) {
      return clampConfidence(
        selected.pick.hybridConfidence ??
          selected.pick.pFinal ??
          selected.pick.confidence ??
          0
      );
    }
    const pick = rm.predictions[marketKey as LogMarketKey];
    if (pick) {
      return clampConfidence(
        pick.hybridConfidence ?? pick.pFinal ?? pick.confidence ?? 0
      );
    }
  }
  return null;
}

export function processBatchDecisions(params: {
  batch: PredictionBatch;
  allBatches: PredictionBatch[];
  comboSettings: CombinedOddsSettings;
  analysis: AnalysisHistory | null;
  teamsQuality: TeamsQualityStore | null;
  learnerStats: LearnerStatsStore | null;
  leaguePriors?: LeaguePriorsStore | null;
}): MatchDecisionRow[] {
  const {
    batch,
    allBatches,
    comboSettings,
    analysis,
    teamsQuality,
    learnerStats,
    leaguePriors,
  } = params;

  const caches = buildDecisionBatchCaches({
    batch,
    allBatches,
    comboSettings,
    analysis,
    teamsQuality,
    learnerStats,
  });

  const batchDisplayId = getBatchDisplayId(batch);

  return batch.matches.map((match) => {
    const league = matchLeague(match, batch.league);
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
    const result = generateTopThreeMarkets(
      matchData,
      fallbacksFromMatch(batch, match),
      { leagueName: league, leaguePriors }
    );

    const topKeys = result.markets.map((m) => m.marketKey);
    const comboRow = caches.comboByMatchId.get(match.id) ?? null;
    const evaluated = comboRow?.allEvaluated ?? [];
    const bestCombined =
      pickMandatoryCombo(evaluated, topKeys) ?? comboRow?.selected ?? null;

    const primaryKey = Object.entries(match.predictions).find(
      ([, p]) => p?.prediction
    )?.[0];
    // Prefer highest-confidence for system % lookup (same as eval helper)
    let lookupKey = primaryKey;
    let bestConf = -1;
    for (const [key, pred] of Object.entries(match.predictions)) {
      if (!pred?.prediction) continue;
      const c = pred.confidence ?? 50;
      if (c > bestConf) {
        bestConf = c;
        lookupKey = key;
      }
    }
    const systemPct = lookupKey
      ? systemPctForUserMarket(batch, match.id, lookupKey, result.markets)
      : null;

    const userMarketEval = buildUserMarketEvaluation({
      match,
      topThree: result.markets,
      systemProbabilityPct: systemPct,
    });

    const confidenceScore = computeRowConfidenceScore({
      markets: result.markets,
      comboPFinal: bestCombined?.pFinal ?? null,
      userEval: userMarketEval,
    });

    return {
      match,
      batchId: batch.id,
      batchDisplayId,
      league,
      markets: result.markets,
      bestCombined,
      userMarketEval,
      confidenceScore,
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
  leaguePriors?: LeaguePriorsStore | null;
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
      leaguePriors: params.leaguePriors,
    }),
  }));
}
