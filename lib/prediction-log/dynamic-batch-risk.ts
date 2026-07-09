import { analyzeAllBatches, type BatchAnalysisRow } from "./batch-analysis";
import {
  BATCH_LOSE_BLEND,
  BATCH_RISK_WEIGHTS,
  LEG_WEAKNESS_WEIGHTS,
  MIN_BATCH_HISTORY_SAMPLE,
  WEAK_MARKET_ACCURACY_THRESHOLD,
  batchRiskBand,
  oddsHistoryBucketIndex,
  type BatchRiskBand,
} from "./batch-risk-config";
import {
  computeROdds,
  computeRBatch,
  computePFinal,
  computeRLoss,
} from "./master-probability";
import { confidenceBand, FORMULA_CONFIG } from "./master-probability-config";
import type { ComparisonResult } from "./club-comparison";
import { applyTierBoostToPFinal } from "./teams-quality";
import { bayesianRiskMultiplier } from "./bayesian-tier";
import { isLowConcentration, LOW_CONCENTRATION_BAYESIAN_SCALE } from "./correct-score";
import type { TierMatchInfo } from "./teams-quality-types";
import type { TeamsQualityStore } from "./teams-quality-types";
import type { AnalysisHistory, LogMarketKey, PredictionBatch, LeagueCharacterProfile } from "./types";

export interface ActiveLeg {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  marketKey: LogMarketKey;
  odds: number;
  pSignal?: number;
  prediction?: string;
  bayesianIntervalWidth?: number;
  concentrationIndex?: number | null;
}

export interface BatchRiskResult {
  totalOdds: number | null;
  score: number;
  band: BatchRiskBand;
  totalOddsRisk: number;
  batchLoseHistoryRisk: number;
  oddsHistoryWinRate: number | null;
  oddsHistorySample: number;
  sizeLossRate: number | null;
  sizeHistorySample: number;
  weakTypeFactor: number;
  explanation: string;
  rOdds: number;
  rLoss: number;
  rBatch: number;
  batchConfidence: number | null;
  pFinalByMatch: Record<string, number>;
  pFinalBaseByMatch: Record<string, number>;
  tierBoostByMatch: Record<string, number>;
  tierInfoByMatch: Record<string, TierMatchInfo>;
}

export interface ReductionStep {
  matchId: string;
  label: string;
  oddsBefore: number;
  oddsAfter: number;
  riskBefore: number;
  riskAfter: number;
  bandAfter: BatchRiskBand;
  pFinalBefore: number | null;
  pFinalAfter: number | null;
}

export interface BatchRiskContext {
  batches: PredictionBatch[];
  analysis: AnalysisHistory | null;
  h2hByMatch?: Record<string, ComparisonResult>;
  teamsQuality?: TeamsQualityStore | null;
  leagueCharacterProfile?: LeagueCharacterProfile | null;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function combinedOddsFromLegs(legs: ActiveLeg[]): number | null {
  if (legs.length === 0) return null;
  const product = legs.reduce((acc, leg) => acc * leg.odds, 1);
  return Math.round(product * 100) / 100;
}

function batchCombinedOdds(row: BatchAnalysisRow): number | null {
  const withOdds = row.legs.filter((l) => l.odds != null && l.odds > 0);
  if (withOdds.length === 0) return null;
  return Math.round(withOdds.reduce((acc, l) => acc * l.odds!, 1) * 100) / 100;
}

interface OddsBucketStats {
  wins: number;
  total: number;
}

interface SizeBucketStats {
  losses: number;
  total: number;
}

function buildOddsHistory(batches: PredictionBatch[]): Map<number, OddsBucketStats> {
  const map = new Map<number, OddsBucketStats>();
  for (const row of analyzeAllBatches(batches)) {
    if (row.batchWon == null) continue;
    const combined = batchCombinedOdds(row);
    if (combined == null) continue;
    const idx = oddsHistoryBucketIndex(combined);
    const cur = map.get(idx) ?? { wins: 0, total: 0 };
    cur.total++;
    if (row.batchWon) cur.wins++;
    map.set(idx, cur);
  }
  return map;
}

function buildSizeHistory(batches: PredictionBatch[]): Map<number, SizeBucketStats> {
  const map = new Map<number, SizeBucketStats>();
  for (const row of analyzeAllBatches(batches)) {
    if (row.batchWon == null) continue;
    const cur = map.get(row.matchCount) ?? { losses: 0, total: 0 };
    cur.total++;
    if (!row.batchWon) cur.losses++;
    map.set(row.matchCount, cur);
  }
  return map;
}

function totalOddsRiskFromHistory(
  combinedOdds: number,
  oddsHistory: Map<number, OddsBucketStats>
): { risk: number; winRate: number | null; sample: number } {
  const idx = oddsHistoryBucketIndex(combinedOdds);
  const stats = oddsHistory.get(idx);
  if (!stats || stats.total < MIN_BATCH_HISTORY_SAMPLE) {
    return { risk: 50, winRate: null, sample: stats?.total ?? 0 };
  }
  const winRate = Math.round((stats.wins / stats.total) * 100);
  return { risk: clamp(100 - winRate), winRate, sample: stats.total };
}

function sizeLossRateFromHistory(
  matchCount: number,
  sizeHistory: Map<number, SizeBucketStats>
): { lossRate: number | null; sample: number } {
  const stats = sizeHistory.get(matchCount);
  if (!stats || stats.total < MIN_BATCH_HISTORY_SAMPLE) {
    return { lossRate: null, sample: stats?.total ?? 0 };
  }
  return {
    lossRate: Math.round((stats.losses / stats.total) * 100),
    sample: stats.total,
  };
}

function weakTypeFactor(legs: ActiveLeg[], analysis: AnalysisHistory | null): number {
  if (!analysis || legs.length === 0) return 0;
  const weakScores: number[] = [];
  for (const leg of legs) {
    const stats = analysis.marketAccuracy[leg.marketKey];
    if (!stats) continue;
    const sample = stats.correct + stats.wrong;
    if (sample < 3 || stats.pct == null) continue;
    if (stats.pct < WEAK_MARKET_ACCURACY_THRESHOLD) {
      weakScores.push(100 - stats.pct);
    }
  }
  if (weakScores.length === 0) return 0;
  return Math.round(weakScores.reduce((a, b) => a + b, 0) / weakScores.length);
}

function batchLoseHistoryRisk(
  legs: ActiveLeg[],
  analysis: AnalysisHistory | null,
  sizeHistory: Map<number, SizeBucketStats>
): { risk: number; sizeLossRate: number | null; sizeSample: number; weakType: number } {
  const { lossRate, sample } = sizeLossRateFromHistory(legs.length, sizeHistory);
  const weakType = weakTypeFactor(legs, analysis);
  const sizeComponent = lossRate ?? 50;
  const risk = clamp(
    sizeComponent * BATCH_LOSE_BLEND.sizeLossRate + weakType * BATCH_LOSE_BLEND.weakTypeFactor
  );
  return { risk, sizeLossRate: lossRate, sizeSample: sample, weakType };
}

export function computeBatchRisk(
  legs: ActiveLeg[],
  ctx: BatchRiskContext
): BatchRiskResult {
  const totalOdds = combinedOddsFromLegs(legs);
  const oddsHistory = buildOddsHistory(ctx.batches);
  const sizeHistory = buildSizeHistory(ctx.batches);

  if (totalOdds == null || legs.length === 0) {
    return {
      totalOdds: null,
      score: 0,
      band: "safe",
      totalOddsRisk: 0,
      batchLoseHistoryRisk: 0,
      oddsHistoryWinRate: null,
      oddsHistorySample: 0,
      sizeLossRate: null,
      sizeHistorySample: 0,
      weakTypeFactor: 0,
      explanation: "Add legs to calculate batch risk.",
      rOdds: 0,
      rLoss: 0,
      rBatch: 0,
      batchConfidence: null,
      pFinalByMatch: {},
      pFinalBaseByMatch: {},
      tierBoostByMatch: {},
      tierInfoByMatch: {},
    };
  }

  const oddsPart = totalOddsRiskFromHistory(totalOdds, oddsHistory);
  const losePart = batchLoseHistoryRisk(legs, ctx.analysis, sizeHistory);

  const score = clamp(
    oddsPart.risk * BATCH_RISK_WEIGHTS.totalOdds +
      losePart.risk * BATCH_RISK_WEIGHTS.batchLoseHistory
  );

  const oddsNote =
    oddsPart.winRate != null
      ? `${oddsPart.winRate}% batch win rate at this odds level (${oddsPart.sample} samples)`
      : `limited odds history (${oddsPart.sample} samples)`;
  const sizeNote =
    losePart.sizeLossRate != null
      ? `${losePart.sizeLossRate}% loss rate for ${legs.length}-match batches (${losePart.sizeSample} samples)`
      : `limited size history (${losePart.sizeSample} samples)`;

  const rOddsVal = computeROdds(totalOdds);
  const rLossVal = computeRLoss(legs.length, ctx.batches);
  let rBatchVal = computeRBatch(rOddsVal, rLossVal);
  const avgIntervalWidth =
    legs.reduce((s, l) => {
      let w = l.bayesianIntervalWidth ?? 0;
      if (l.concentrationIndex != null && isLowConcentration(l.concentrationIndex)) {
        w *= LOW_CONCENTRATION_BAYESIAN_SCALE;
      }
      return s + w;
    }, 0) / Math.max(1, legs.length);
  rBatchVal = Math.min(
    1,
    rBatchVal * bayesianRiskMultiplier(avgIntervalWidth || null, ctx.leagueCharacterProfile ?? null)
  );

  const pFinalByMatch: Record<string, number> = {};
  const pFinalBaseByMatch: Record<string, number> = {};
  const tierBoostByMatch: Record<string, number> = {};
  const tierInfoByMatch: Record<string, TierMatchInfo> = {};
  let pFinalSum = 0;
  let pFinalCount = 0;
  for (const leg of legs) {
    const ps = leg.pSignal ?? 50;
    const pfBase = computePFinal(ps, rBatchVal);
    pFinalBaseByMatch[leg.matchId] = pfBase;

    const tierOverlay = applyTierBoostToPFinal(
      pfBase,
      leg.homeTeam,
      leg.awayTeam,
      leg.marketKey,
      leg.prediction ?? "",
      ctx.teamsQuality,
      ctx.leagueCharacterProfile ?? null
    );
    const pf = tierOverlay.pFinalWithTier;
    pFinalByMatch[leg.matchId] = pf;
    tierBoostByMatch[leg.matchId] = tierOverlay.appliedBoost;
    tierInfoByMatch[leg.matchId] = tierOverlay;
    pFinalSum += pf;
    pFinalCount++;
  }
  const batchConfidence = pFinalCount > 0 ? Math.round(pFinalSum / pFinalCount) : null;

  return {
    totalOdds,
    score,
    band: batchRiskBand(score),
    totalOddsRisk: oddsPart.risk,
    batchLoseHistoryRisk: losePart.risk,
    oddsHistoryWinRate: oddsPart.winRate,
    oddsHistorySample: oddsPart.sample,
    sizeLossRate: losePart.sizeLossRate,
    sizeHistorySample: losePart.sizeSample,
    weakTypeFactor: losePart.weakType,
    explanation: `${oddsNote}; ${sizeNote}.`,
    rOdds: rOddsVal,
    rLoss: rLossVal,
    rBatch: rBatchVal,
    batchConfidence,
    pFinalByMatch,
    pFinalBaseByMatch,
    tierBoostByMatch,
    tierInfoByMatch,
  };
}

function legWeakness(
  leg: ActiveLeg,
  legs: ActiveLeg[],
  analysis: AnalysisHistory | null,
  h2hByMatch?: Record<string, ComparisonResult>
): number {
  const stats = analysis?.marketAccuracy[leg.marketKey];
  const typeSample = stats ? stats.correct + stats.wrong : 0;
  const typePct =
    stats?.pct != null && typeSample >= 3 ? stats.pct : 50;
  const typeWeak = 100 - typePct;

  const h2h = h2hByMatch?.[leg.matchId];
  const h2hConf = h2h?.confidence ?? 50;
  const h2hWeak = 100 - h2hConf;

  const product = combinedOddsFromLegs(legs) ?? leg.odds;
  const without = combinedOddsFromLegs(legs.filter((l) => l.matchId !== leg.matchId)) ?? 1;
  const inflationPct =
    product > 0 ? clamp(((product / without - 1) / product) * 100 * legs.length) : 0;

  return (
    typeWeak * LEG_WEAKNESS_WEIGHTS.typeAccuracy +
    h2hWeak * LEG_WEAKNESS_WEIGHTS.h2hConfidence +
    inflationPct * LEG_WEAKNESS_WEIGHTS.oddsInflation
  );
}

export function computeReductionPlan(
  legs: ActiveLeg[],
  ctx: BatchRiskContext
): ReductionStep[] {
  const current = computeBatchRisk(legs, ctx);
  const { riskCeiling, confidenceFloor } = FORMULA_CONFIG;

  const needsReduction =
    current.band === "high" ||
    current.rBatch > riskCeiling ||
    (current.batchConfidence != null && current.batchConfidence < confidenceFloor);

  if (!needsReduction || legs.length <= 1) return [];

  const steps: ReductionStep[] = [];
  let remaining = [...legs];
  let riskBefore = current.score;
  let oddsBefore = current.totalOdds ?? 0;
  let batchConfBefore = current.batchConfidence;

  while (remaining.length > 1) {
    const rBatchCurrent = computeROdds(combinedOddsFromLegs(remaining) ?? 0);
    const rLossCurrent = computeRLoss(remaining.length, ctx.batches);
    const rBCurrent = computeRBatch(rBatchCurrent, rLossCurrent);

    let worstIdx = 0;
    let worstPFinal = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const ps = remaining[i]!.pSignal ?? 50;
      const pf = computePFinal(ps, rBCurrent);
      if (pf < worstPFinal) {
        worstPFinal = pf;
        worstIdx = i;
      }
    }

    const removeLeg = remaining[worstIdx]!;
    const afterLegs = remaining.filter((_, i) => i !== worstIdx);
    const afterRisk = computeBatchRisk(afterLegs, ctx);

    steps.push({
      matchId: removeLeg.matchId,
      label: `${removeLeg.homeTeam} vs ${removeLeg.awayTeam}`,
      oddsBefore,
      oddsAfter: afterRisk.totalOdds ?? 0,
      riskBefore,
      riskAfter: afterRisk.score,
      bandAfter: afterRisk.band,
      pFinalBefore: batchConfBefore,
      pFinalAfter: afterRisk.batchConfidence,
    });

    remaining = afterLegs;
    riskBefore = afterRisk.score;
    oddsBefore = afterRisk.totalOdds ?? 0;
    batchConfBefore = afterRisk.batchConfidence;

    const meetsRisk = afterRisk.rBatch <= riskCeiling;
    const meetsConf = afterRisk.batchConfidence == null || afterRisk.batchConfidence >= confidenceFloor;
    if (meetsRisk && meetsConf) break;
    if (afterRisk.band === "safe" || afterRisk.band === "caution") break;
  }

  return steps;
}

export function activeLegsFromRecommended(
  batch: PredictionBatch
): ActiveLeg[] {
  const reco = batch.recommended;
  if (!reco) return [];

  const legs: ActiveLeg[] = [];
  for (const rm of reco.matches) {
    const pickEntry = Object.entries(rm.predictions).find(
      ([, p]) => p && p.action !== "remove" && p.accepted !== false
    ) as [LogMarketKey, NonNullable<(typeof rm.predictions)[LogMarketKey]>] | undefined;
    if (!pickEntry || !pickEntry[1].odds) continue;
    const logMatch = batch.matches.find((m) => m.id === rm.id);
    legs.push({
      matchId: rm.id,
      homeTeam: rm.homeTeam,
      awayTeam: rm.awayTeam,
      marketKey: pickEntry[0],
      odds: pickEntry[1].odds,
      pSignal: pickEntry[1].pSignal,
      prediction: pickEntry[1].prediction,
      bayesianIntervalWidth: pickEntry[1].mathSnapshot?.statLayer?.bayesianLayer?.intervalWidth,
      concentrationIndex:
        pickEntry[1].mathSnapshot?.concentrationIndex ??
        logMatch?.correctScoreSnapshot?.concentrationIndex ??
        null,
    });
  }
  return legs;
}
