import { enabledComboMarkets, DEFAULT_COMBO_MARKETS } from "./combo-markets-config";
import { comboValue, computeComboPFinal } from "./combo-probability";
import { computeBatchRisk, type ActiveLeg } from "./dynamic-batch-risk";
import { ensureComboRecommendedShell } from "./prepare-batch-combos";
import { getMarketComparisonForMatch, getSelectedPickForMatch } from "./snapshot-readers";
import type { TeamsQualityStore } from "./teams-quality-types";
import type {
  AnalysisHistory,
  CombinedOddsSettings,
  ComboMarketDef,
  FrozenMarketEntry,
  LearnerStatsStore,
  PredictionBatch,
  RecommendationTier,
  RecommendedMatch,
} from "./types";

export interface ComboCandidate {
  comboId: string;
  label: string;
  pGrid: number;
  pFinal: number;
  odds: number | null;
  value: number | null;
}

export interface MatchComboResult {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  selected: ComboCandidate | null;
  alternative: ComboCandidate | null;
  fallbackSingle: FrozenMarketEntry | null;
  allEvaluated: ComboCandidate[];
  hasGrid: boolean;
  /** True when a combo was selected but pFinal is under the active tier floor (soft warning only). */
  belowTierFloor: boolean;
}

export interface ComboAccumulatorResult {
  legs: MatchComboResult[];
  droppedLegs: MatchComboResult[];
  combinedProbability: number | null;
  combinedOdds: number | null;
  riskAdjustedConfidence: number | null;
  status: "safe" | "below_floor" | "insufficient_legs";
  rBatch: number;
  rLoss: number;
  droppedCount: number;
}

function toCandidate(
  result: NonNullable<ReturnType<typeof computeComboPFinal>>,
  odds: number | null
): ComboCandidate {
  return {
    comboId: result.comboId,
    label: result.label,
    pGrid: result.pGrid,
    pFinal: result.pFinal,
    odds,
    value: comboValue(result.pFinal, odds),
  };
}

/** Always pick highest pFinal — tier floor never empties the selection. */
export function pickBestCombo(evaluated: ComboCandidate[]): ComboCandidate | null {
  if (evaluated.length === 0) return null;
  return evaluated.reduce((best, c) => (c.pFinal > best.pFinal ? c : best));
}

function belowFloorFlag(
  selected: ComboCandidate | null,
  tierFloor: number
): boolean {
  return selected != null && selected.pFinal < tierFloor;
}

function pickAlternative(
  selected: ComboCandidate | null,
  evaluated: ComboCandidate[],
  thresholdPct: number
): ComboCandidate | null {
  if (!selected || evaluated.length < 2) return null;
  const others = evaluated.filter((c) => c.comboId !== selected.comboId);
  if (others.length === 0) return null;
  const best = others.reduce((a, b) => (b.pFinal > a.pFinal ? b : a));
  if (best.pFinal - selected.pFinal >= thresholdPct) return best;
  return null;
}

export function evaluateMatchCombos(
  batch: PredictionBatch,
  rm: RecommendedMatch,
  settings: CombinedOddsSettings,
  tier: RecommendationTier,
  teamsQuality?: TeamsQualityStore | null,
  learnerStats?: LearnerStatsStore | null,
  comboFilter?: (combo: ComboMarketDef) => boolean
): MatchComboResult {
  const math = batch.recommended?.mathSnapshot;
  const selected = getSelectedPickForMatch(rm);
  const grid = selected?.pick.mathSnapshot?.statLayer?.scoreGrid;
  const comboOdds = batch.recommended?.comboOddsByMatch?.[rm.id] ?? null;
  const tierFloor = settings.tierMinPFinal[tier];
  const comparison = getMarketComparisonForMatch(batch, rm.id);
  const fallbackSingle = comparison.find((e) => e.selected) ?? comparison[0] ?? null;
  const logMatch = batch.matches.find((m) => m.id === rm.id);
  const userComboId =
    batch.recommended?.comboPickByMatch?.[rm.id] ?? logMatch?.comboPick?.comboId;

  if (!grid) {
    if (userComboId && logMatch?.comboPick) {
      const label =
        DEFAULT_COMBO_MARKETS.find((c) => c.id === userComboId)?.label ??
        userComboId.replace(/_/g, " ");
      const pGrid = logMatch.comboPick.systemProbability ?? 0;
      const selectedCombo: ComboCandidate = {
        comboId: userComboId,
        label,
        pGrid,
        pFinal: pGrid,
        odds: comboOdds,
        value: comboValue(pGrid, comboOdds),
      };
      return {
        matchId: rm.id,
        homeTeam: rm.homeTeam,
        awayTeam: rm.awayTeam,
        selected: selectedCombo,
        alternative: null,
        fallbackSingle,
        allEvaluated: [selectedCombo],
        hasGrid: false,
        belowTierFloor: belowFloorFlag(selectedCombo, tierFloor),
      };
    }
    return {
      matchId: rm.id,
      homeTeam: rm.homeTeam,
      awayTeam: rm.awayTeam,
      selected: null,
      alternative: null,
      fallbackSingle,
      allEvaluated: [],
      hasGrid: false,
      belowTierFloor: false,
    };
  }

  const minSample = selected?.pick.dataSampleSize ?? 0;
  const rBatch = math?.rBatch ?? 0;
  const evaluated: ComboCandidate[] = [];

  for (const combo of enabledComboMarkets(settings.markets)) {
    if (comboFilter && !comboFilter(combo)) continue;
    const result = computeComboPFinal({
      combo,
      grid,
      lambdaHome: selected?.pick.mathSnapshot?.statLayer?.lambdaHome,
      lambdaAway: selected?.pick.mathSnapshot?.statLayer?.lambdaAway,
      mathSnapshot: selected?.pick.mathSnapshot,
      rBatch,
      homeTeam: rm.homeTeam,
      awayTeam: rm.awayTeam,
      minSample,
      settings,
      teamsQuality,
      comboTypeStats: learnerStats?.comboTypeStats,
    });
    if (!result || result.skipped) continue;
    evaluated.push(toCandidate(result, null));
  }

  evaluated.sort((a, b) => b.pFinal - a.pFinal);
  let best = pickBestCombo(evaluated);
  if (userComboId) {
    const userPick = evaluated.find((c) => c.comboId === userComboId);
    if (userPick) best = userPick;
    else if (logMatch?.comboPick?.systemProbability != null) {
      const label =
        DEFAULT_COMBO_MARKETS.find((c) => c.id === userComboId)?.label ??
        userComboId.replace(/_/g, " ");
      best = {
        comboId: userComboId,
        label,
        pGrid: logMatch.comboPick.systemProbability,
        pFinal: logMatch.comboPick.systemProbability,
        odds: comboOdds,
        value: comboValue(logMatch.comboPick.systemProbability, comboOdds),
      };
    }
  }
  if (best && comboOdds != null) {
    best = { ...best, odds: comboOdds, value: comboValue(best.pFinal, comboOdds) };
  }
  const alternative = pickAlternative(best, evaluated, settings.betterAlternativeThresholdPct);

  return {
    matchId: rm.id,
    homeTeam: rm.homeTeam,
    awayTeam: rm.awayTeam,
    selected: best,
    alternative,
    fallbackSingle,
    allEvaluated: evaluated,
    hasGrid: true,
    belowTierFloor: belowFloorFlag(best, tierFloor),
  };
}

function productPFinal(legs: MatchComboResult[]): number | null {
  const withCombo = legs.filter((l) => l.selected);
  if (withCombo.length === 0) return null;
  return Math.round(
    withCombo.reduce((acc, l) => acc * (l.selected!.pFinal / 100), 1) * 100
  );
}

function productOdds(legs: MatchComboResult[]): number | null {
  const odds = legs.map((l) => l.selected?.odds).filter((o): o is number => o != null && o > 1);
  if (odds.length !== legs.filter((l) => l.selected).length) return null;
  return Math.round(odds.reduce((a, b) => a * b, 100)) / 100;
}

function matchResultsToActiveLegs(results: MatchComboResult[]): ActiveLeg[] {
  return results
    .filter((r) => r.selected)
    .map((r) => ({
      matchId: r.matchId,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      marketKey: "1x2" as const,
      odds: r.selected!.odds ?? 2,
      pSignal: r.selected!.pFinal,
      prediction: "home",
    }));
}

export function buildComboAccumulator(
  matchResults: MatchComboResult[],
  batch: PredictionBatch,
  settings: CombinedOddsSettings,
  tier: RecommendationTier,
  analysis: AnalysisHistory | null,
  allBatches: PredictionBatch[],
  teamsQuality?: TeamsQualityStore | null
): ComboAccumulatorResult {
  const tierFloor = settings.tierMinPFinal[tier];
  let legs = matchResults.filter((m) => m.selected);
  const droppedLegs: MatchComboResult[] = [];

  while (legs.length > 2) {
    const combinedProbability = productPFinal(legs);
    const activeLegs = matchResultsToActiveLegs(legs);
    const risk = computeBatchRisk(activeLegs, {
      batches: allBatches,
      analysis,
      teamsQuality,
    });
    const riskAdjusted = risk.batchConfidence ?? combinedProbability;

    if (
      combinedProbability != null &&
      combinedProbability >= tierFloor &&
      (riskAdjusted == null || riskAdjusted >= tierFloor)
    ) {
      break;
    }

    const weakest = legs.reduce((min, l) =>
      (l.selected?.pFinal ?? 100) < (min.selected?.pFinal ?? 100) ? l : min
    );
    droppedLegs.push(weakest);
    legs = legs.filter((l) => l.matchId !== weakest.matchId);
  }

  const finalActive = matchResultsToActiveLegs(legs);
  const risk = computeBatchRisk(finalActive, {
    batches: allBatches,
    analysis,
    teamsQuality,
  });
  const combinedProbability = productPFinal(legs);
  const combinedOdds = productOdds(legs);
  const riskAdjustedConfidence = risk.batchConfidence ?? combinedProbability;

  let status: ComboAccumulatorResult["status"] = "safe";
  if (legs.length < 2) {
    status = "insufficient_legs";
  } else if (
    combinedProbability == null ||
    combinedProbability < tierFloor ||
    (riskAdjustedConfidence != null && riskAdjustedConfidence < tierFloor)
  ) {
    status = "below_floor";
  }

  return {
    legs,
    droppedLegs,
    combinedProbability,
    combinedOdds,
    riskAdjustedConfidence,
    status,
    rBatch: risk.rBatch,
    rLoss: risk.rLoss,
    droppedCount: droppedLegs.length,
  };
}

export function evaluateBatchCombos(
  batch: PredictionBatch,
  settings: CombinedOddsSettings,
  analysis: AnalysisHistory | null,
  allBatches: PredictionBatch[],
  teamsQuality?: TeamsQualityStore | null,
  learnerStats?: LearnerStatsStore | null,
  tier: RecommendationTier = "balanced",
  comboFilter?: (combo: ComboMarketDef) => boolean
): { matches: MatchComboResult[]; accumulator: ComboAccumulatorResult } {
  const prepared = ensureComboRecommendedShell(batch);
  const recommended = prepared.recommended;
  if (!recommended?.matches.length) {
    return {
      matches: [],
      accumulator: {
        legs: [],
        droppedLegs: [],
        combinedProbability: null,
        combinedOdds: null,
        riskAdjustedConfidence: null,
        status: "insufficient_legs",
        rBatch: 0,
        rLoss: 0,
        droppedCount: 0,
      },
    };
  }

  const matches = recommended.matches.map((rm) =>
    evaluateMatchCombos(prepared, rm, settings, tier, teamsQuality, learnerStats, comboFilter)
  );
  const accumulator = buildComboAccumulator(
    matches,
    batch,
    settings,
    tier,
    analysis,
    allBatches,
    teamsQuality
  );

  return { matches, accumulator };
}
