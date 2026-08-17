/**
 * WEIGHTING-EXEMPT: Batch merge / row settlement must NOT call weightedEstimate.
 * Keep Decision Maker aggregation and user-market evaluation math unchanged.
 * Reco-sourced confidences may already reflect the 60/40 hybrid upstream.
 */
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
import type { ClubHalfAttackDefence } from "../hsh-half-rates";
import { pickMandatoryCombo } from "./combo-exclude";
import {
  aggregateMatchData,
  generateTopThreeMarkets,
} from "./decision-engine";
import { applyCoherentMarketConfidences } from "./coherent-confidence";
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
    const insuff =
      "insufficientData" in pred &&
      Boolean((pred as { insufficientData?: boolean }).insufficientData);
    if (insuff) continue;
    const conf = pred.confidence ?? 0;
    if (!(conf > 0)) continue;
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
      confidence: clampConfidence(conf),
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
  matchCentreCache?: Map<string, ClubHalfAttackDefence>;
}): MatchDecisionRow[] {
  const {
    batch,
    allBatches,
    comboSettings,
    analysis,
    teamsQuality,
    learnerStats,
    leaguePriors,
    matchCentreCache,
  } = params;

  const caches = buildDecisionBatchCaches({
    batch,
    allBatches,
    comboSettings,
    analysis,
    teamsQuality,
    learnerStats,
    matchCentreCache,
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
      {
        leagueName: league,
        leaguePriors,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
      }
    );
    result.markets = applyCoherentMarketConfidences(result.markets, {
      batch,
      match,
      caches,
    });

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

export async function processBatchDecisionsAsync(params: {
  batch: PredictionBatch;
  allBatches: PredictionBatch[];
  comboSettings: CombinedOddsSettings;
  analysis: AnalysisHistory | null;
  teamsQuality: TeamsQualityStore | null;
  learnerStats: LearnerStatsStore | null;
  leaguePriors?: LeaguePriorsStore | null;
}): Promise<MatchDecisionRow[]> {
  let matchCentreCache: Map<string, ClubHalfAttackDefence> | undefined;
  try {
    const { collectBatchTeamLeaguePairs } = await import(
      "../canonical-fixture-estimate"
    );
    const { preloadMatchCentreHalfRates } = await import(
      "@/lib/match-centre/team-half-rates"
    );
    matchCentreCache = await preloadMatchCentreHalfRates(
      collectBatchTeamLeaguePairs(params.batch)
    );
  } catch {
    matchCentreCache = undefined;
  }
  return processBatchDecisions({ ...params, matchCentreCache });
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
