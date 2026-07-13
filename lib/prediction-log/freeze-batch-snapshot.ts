import { LOG_MARKET_MAP, pickOptionsForMarket } from "./markets-config";
import {
  activeLegsFromRecommended,
  computeBatchRisk,
  computeReductionPlan,
  type BatchRiskResult,
  type ReductionStep,
} from "./dynamic-batch-risk";
import { computePFinal } from "./master-probability";
import { applyTierBoostToPFinal } from "./teams-quality";
import type { ScoredMatchCandidate } from "./match-risk-score";
import type {
  AnalysisHistory,
  FrozenBetterAlternative,
  FrozenMarketEntry,
  FrozenProfessionalRead,
  FrozenProfessionalSlip,
  FrozenSystemPick,
  FrozenWorkflowStep,
  LogMarketKey,
  LogMatch,
  PredictionBatch,
  RecommendationSettings,
  RecommendationTier,
  RecommendedBatch,
  RecommendedBatchMathSnapshot,
  RecommendedPick,
} from "./types";
import {
  buildProfessionalRead,
  computeEdgeMetrics,
  summarizeSlipValue,
  type ProfessionalLegInput,
} from "./professional-estimator";
import type { TeamsQualityStore } from "./teams-quality-types";
import type { LeagueCharacterProfile } from "./types";
import { BETTER_ALTERNATIVE_THRESHOLD_PCT } from "./recommendation-config";
import { FORMULA_CONFIG } from "./master-probability-config";
import { derivePickComment } from "./pick-comment";

export interface TierFreezeMetadata {
  tier: RecommendationTier;
  allLegCandidates: ScoredMatchCandidate[];
  preTrimSelected: ScoredMatchCandidate[];
  postTrimSelected: ScoredMatchCandidate[];
  removedFromDedup: ScoredMatchCandidate[];
  trimRemoved: ScoredMatchCandidate[];
}

function pickLabel(
  marketKey: LogMarketKey,
  prediction: string,
  line: number | undefined,
  homeTeam: string,
  awayTeam: string
): string {
  const opts = pickOptionsForMarket(marketKey, homeTeam, awayTeam, line);
  const found = opts.find((o) => o.value === prediction);
  if (found) return found.label;
  if (line != null) return `${prediction} ${line}`;
  return prediction;
}

function computeCandidatePFinal(
  candidate: ScoredMatchCandidate,
  rBatch: number,
  teamsQuality?: TeamsQualityStore | null,
  leagueCharacterProfile?: LeagueCharacterProfile | null
): number {
  const ps = candidate.pick.pSignal ?? 50;
  const pfBase = computePFinal(ps, rBatch);
  const tierOverlay = applyTierBoostToPFinal(
    pfBase,
    candidate.homeTeam,
    candidate.awayTeam,
    candidate.marketKey,
    candidate.pick.prediction,
    teamsQuality,
    leagueCharacterProfile
  );
  return tierOverlay.pFinalWithTier;
}

export function buildSystemPick(
  match: LogMatch,
  candidates: ScoredMatchCandidate[]
): FrozenSystemPick | null {
  const matchCandidates = candidates.filter((c) => c.matchId === match.id);
  let homePct = 0;
  let drawPct = 0;
  let awayPct = 0;

  for (const candidate of matchCandidates) {
    const ml = candidate.pick.mathSnapshot?.statLayer?.mlProbs;
    if (ml) {
      homePct = Math.max(homePct, ml.home * 100);
      drawPct = Math.max(drawPct, ml.draw * 100);
      awayPct = Math.max(awayPct, ml.away * 100);
    }
  }

  if (homePct === 0 && drawPct === 0 && awayPct === 0) {
    const oneX2 = matchCandidates.find((c) => c.marketKey === "1x2");
    if (oneX2?.pick.pSignal != null) {
      const pred = oneX2.pick.prediction;
      if (pred === "home") homePct = oneX2.pick.pSignal;
      else if (pred === "draw") drawPct = oneX2.pick.pSignal;
      else if (pred === "away") awayPct = oneX2.pick.pSignal;
    }
  }

  if (homePct === 0 && drawPct === 0 && awayPct === 0) return null;

  const max = Math.max(homePct, drawPct, awayPct);
  let outcome: "home" | "draw" | "away";
  if (max === homePct) outcome = "home";
  else if (max === drawPct) outcome = "draw";
  else outcome = "away";

  const label =
    outcome === "draw"
      ? "Draw"
      : outcome === "home"
        ? `${match.homeTeam} to win`
        : `${match.awayTeam} to win`;

  return { outcome, label };
}

export function buildMarketComparison(
  matchId: string,
  allLegCandidates: ScoredMatchCandidate[],
  selectedMarketKey: LogMarketKey | null,
  risk: BatchRiskResult,
  teamsQuality?: TeamsQualityStore | null,
  leagueCharacterProfile?: LeagueCharacterProfile | null
): FrozenMarketEntry[] {
  const matchCandidates = allLegCandidates.filter((c) => c.matchId === matchId);
  const entries: FrozenMarketEntry[] = [];

  for (const candidate of matchCandidates) {
    const isSelected = candidate.marketKey === selectedMarketKey;
    const pFinal = isSelected
      ? (risk.pFinalByMatch[matchId] ??
        computeCandidatePFinal(candidate, risk.rBatch, teamsQuality, leagueCharacterProfile))
      : computeCandidatePFinal(candidate, risk.rBatch, teamsQuality, leagueCharacterProfile);

    const edge = computeEdgeMetrics(pFinal, candidate.pick.odds);

    entries.push({
      marketKey: candidate.marketKey,
      marketLabel: LOG_MARKET_MAP[candidate.marketKey]?.label ?? candidate.marketKey,
      predictionLabel: pickLabel(
        candidate.marketKey,
        candidate.pick.prediction,
        candidate.pick.line,
        candidate.homeTeam,
        candidate.awayTeam
      ),
      pFinal,
      selected: isSelected,
      prediction: candidate.pick.prediction,
      line: candidate.pick.line,
      ...(edge.valid ? { edgePct: edge.edgePct, evPerUnit: edge.evPerUnit } : {}),
    });
  }

  return entries.sort((a, b) => b.pFinal - a.pFinal);
}

export function buildBetterAlternative(
  comparison: FrozenMarketEntry[],
  thresholdPct: number
): FrozenBetterAlternative | null {
  const selected = comparison.find((e) => e.selected);
  if (!selected) return null;

  const best = comparison.reduce((a, b) => (b.pFinal > a.pFinal ? b : a), comparison[0]!);
  const deltaPct = best.pFinal - selected.pFinal;

  if (best.marketKey === selected.marketKey && best.predictionLabel === selected.predictionLabel) {
    return {
      marketKey: selected.marketKey,
      marketLabel: selected.marketLabel,
      predictionLabel: selected.predictionLabel,
      pFinal: selected.pFinal,
      deltaPct: 0,
      isOptimal: true,
      prediction: selected.prediction,
      line: selected.line,
    };
  }

  if (deltaPct < thresholdPct) {
    return {
      marketKey: selected.marketKey,
      marketLabel: selected.marketLabel,
      predictionLabel: selected.predictionLabel,
      pFinal: selected.pFinal,
      deltaPct,
      isOptimal: true,
      prediction: selected.prediction,
      line: selected.line,
    };
  }

  return {
    marketKey: best.marketKey,
    marketLabel: best.marketLabel,
    predictionLabel: best.predictionLabel,
    pFinal: best.pFinal,
    deltaPct,
    isOptimal: false,
    prediction: best.prediction,
    line: best.line,
  };
}

function freezeProfessionalRead(
  pFinalPct: number,
  pick: RecommendedPick
): FrozenProfessionalRead {
  const stat = pick.mathSnapshot?.statLayer;
  const read = buildProfessionalRead({
    pFinalPct,
    odds: pick.odds,
    estimators: {
      pDc: stat?.pDc,
      pMl: stat?.pMl,
      pBayes: stat?.bayesianLayer?.pMarket,
      pCustom: stat?.pCustom,
    },
  });
  return {
    ratingPct: read.ratingPct,
    hasPrice: read.edge.valid,
    edgePct: read.edge.edgePct,
    evPerUnit: read.edge.evPerUnit,
    kellyFraction: read.edge.kellyFraction,
    impliedPct: read.edge.impliedPct,
    fairImpliedPct: read.edge.fairImpliedPct,
    valueTier: read.edge.valueTier,
    agreementPct: Math.round(read.agreement.agreement * 100),
    agreementLabel: read.agreement.label,
    verdict: read.verdict,
  };
}

const TIER_LABELS: Record<RecommendationTier, string> = {
  safe: "Extreme Safe",
  balanced: "Balanced",
  aggressive: "Aggressive",
};

export function buildWorkflowLog(
  metadata: TierFreezeMetadata,
  risk: BatchRiskResult,
  reductionSteps: ReductionStep[]
): FrozenWorkflowStep[] {
  const steps: FrozenWorkflowStep[] = [];

  steps.push({
    phase: "tier_selection",
    message: `${TIER_LABELS[metadata.tier]} tier: ${metadata.postTrimSelected.length} match(es) selected from ${metadata.allLegCandidates.length} candidate leg(s).`,
  });

  if (metadata.removedFromDedup.length > 0) {
    for (const removed of metadata.removedFromDedup) {
      steps.push({
        phase: "dedup",
        message: `${removed.homeTeam} vs ${removed.awayTeam} (${LOG_MARKET_MAP[removed.marketKey]?.label ?? removed.marketKey}) skipped — same fixture/market already recommended today.`,
        matchId: removed.matchId,
      });
    }
  }

  for (const removed of metadata.trimRemoved) {
    steps.push({
      phase: "risk_trim",
      message: `Weakest link removed: ${removed.homeTeam} vs ${removed.awayTeam} (${LOG_MARKET_MAP[removed.marketKey]?.label ?? removed.marketKey}) to meet tier risk constraints.`,
      matchId: removed.matchId,
    });
  }

  steps.push({
    phase: "risk_brake",
    message: `Batch risk brake applied — R_batch ${(risk.rBatch * 100).toFixed(0)}%, average P_final ${risk.batchConfidence ?? "—"}%, combined odds ${risk.totalOdds?.toFixed(2) ?? "—"}.`,
  });

  for (const step of reductionSteps) {
    steps.push({
      phase: "reduction_plan",
      message: `Suggested removal: ${step.label} — risk ${step.riskBefore} → ${step.riskAfter}, batch confidence ${step.pFinalBefore ?? "—"}% → ${step.pFinalAfter ?? "—"}%.`,
      matchId: step.matchId,
    });
  }

  return steps;
}

export function buildExtendedMathSnapshot(
  batch: PredictionBatch,
  recommended: RecommendedBatch,
  allBatches: PredictionBatch[],
  analysis: AnalysisHistory,
  settings: RecommendationSettings,
  learnerEnabled: boolean,
  luckyNumbers: number[],
  risk: BatchRiskResult,
  metadata: TierFreezeMetadata,
  teamsQuality?: TeamsQualityStore | null,
  leagueCharacterProfile?: LeagueCharacterProfile | null
): RecommendedBatchMathSnapshot {
  const threshold =
    settings.betterAlternativeThresholdPct ?? BETTER_ALTERNATIVE_THRESHOLD_PCT;

  const sourceBatch = allBatches.find((b) => b.id === batch.sourceBatchId);
  const sourceMatches = sourceBatch?.matches ?? batch.matches;

  const marketComparisonByMatch: Record<string, FrozenMarketEntry[]> = {};
  const systemPickByMatch: Record<string, FrozenSystemPick> = {};
  const betterAlternativeByMatch: Record<string, FrozenBetterAlternative> = {};
  const professionalByMatch: Record<string, FrozenProfessionalRead> = {};
  const slipLegs: ProfessionalLegInput[] = [];
  const pickCommentByMatch: Record<
    string,
    { label: "good" | "risky" | "avoid"; message: string }
  > = {};

  for (const rm of recommended.matches) {
    const sourceMatch = sourceMatches.find((m) => m.id === rm.id);
    if (!sourceMatch) continue;

    const selectedEntry = Object.entries(rm.predictions).find(
      ([, p]) => p && p.action !== "remove"
    ) as [LogMarketKey, (typeof rm.predictions)[LogMarketKey]] | undefined;
    const selectedKey = selectedEntry?.[0] ?? null;

    const comparison = buildMarketComparison(
      rm.id,
      metadata.allLegCandidates,
      selectedKey,
      risk,
      teamsQuality,
      leagueCharacterProfile
    );
    marketComparisonByMatch[rm.id] = comparison;

    const systemPick = buildSystemPick(sourceMatch, metadata.allLegCandidates);
    if (systemPick) systemPickByMatch[rm.id] = systemPick;

    const betterAlt = buildBetterAlternative(comparison, threshold);
    if (betterAlt) betterAlternativeByMatch[rm.id] = betterAlt;

    const selectedPFinal = risk.pFinalByMatch[rm.id] ?? selectedEntry?.[1]?.pFinal ?? null;
    pickCommentByMatch[rm.id] = derivePickComment({
      selectedPFinal,
      betterAlt,
      riskyGapPct: threshold,
    });

    const selectedPick = selectedEntry?.[1];
    if (selectedPick && selectedPFinal != null) {
      professionalByMatch[rm.id] = freezeProfessionalRead(selectedPFinal, selectedPick);
      slipLegs.push({
        matchLabel: `${rm.homeTeam} vs ${rm.awayTeam}`,
        modelPct: selectedPFinal,
        odds: selectedPick.odds,
      });
    }
  }

  const professionalSummary: FrozenProfessionalSlip = summarizeSlipValue(slipLegs);

  const legs = activeLegsFromRecommended(batch);
  const reductionSteps = computeReductionPlan(legs, {
    batches: allBatches,
    analysis,
    teamsQuality,
    leagueCharacterProfile,
  });
  const workflowLog = buildWorkflowLog(metadata, risk, reductionSteps);

  return {
    totalCombinedOdds: risk.totalOdds,
    batchRiskScore: risk.score,
    batchRiskBand: risk.band,
    rOdds: risk.rOdds,
    rLoss: risk.rLoss,
    rBatch: risk.rBatch,
    averagePFinal: risk.batchConfidence,
    lambda: FORMULA_CONFIG.lambda_riskSensitivity,
    pFinalByMatch: risk.pFinalByMatch,
    pFinalBaseByMatch: risk.pFinalBaseByMatch,
    tierBoostByMatch: risk.tierBoostByMatch,
    tierInfoByMatch: risk.tierInfoByMatch,
    marketComparisonByMatch,
    systemPickByMatch,
    betterAlternativeByMatch,
    professionalByMatch,
    professionalSummary,
    pickCommentByMatch,
    workflowLog,
    reductionSteps,
    settingsSnapshot: {
      oddsFilteringEnabled: settings.oddsFilteringEnabled,
      tier1MinPFinal: settings.tier1MinPFinal,
      tier3MaxBatchRisk: settings.tier3MaxBatchRisk,
      tier3AllowAlternativeMarkets: settings.tier3AllowAlternativeMarkets,
      learnerEnabled,
      luckyNumbers,
      betterAlternativeThresholdPct: threshold,
    },
  };
}
