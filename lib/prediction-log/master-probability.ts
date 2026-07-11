import {
  FORMULA_CONFIG,
  CAPACITY_FIELD_MAP,
  confidenceBand,
  type ConfidenceBand,
  type CapacityFieldMapping,
} from "./master-probability-config";
import { marketToHistoryType } from "./club-record-insights";
import { oddsMatchesLuckyNumber } from "./lucky-numbers";
import { analyzeAllBatches } from "./batch-analysis";
import type { ClubCapacity, ClubRecord, HistoryEntry } from "./club-record-types";
import type { AnalysisHistory, LogMarketKey, LogMatch, PredictionBatch, MarketPrediction } from "./types";
import type { RecommendationContext } from "./recommendation-context";
import { computeDixonColes } from "./statistics-engine";
import { buildInferenceFeatures } from "./training-data";
import { predictMlOutcome } from "./ml-engine";
import {
  applyCalibration,
  blendSignalWithStat,
  computePStat,
  shrinkPStat,
  confidenceFromInterval,
} from "./stat-probability";
import { BAYESIAN_CONFIG } from "./bayesian-config";
import { computeBayesianMatchPrediction } from "./bayesian-predict";
import { applyLeagueAdjustToPSignal } from "./league-character";
import { computeLineupContextSignal } from "./lineup-context";
import type { LeagueAdjustAudit } from "./types";

export interface SignalResult {
  value: number;
  reliability: number;
}

export interface MasterProbabilityResult {
  pSignal: number;
  pCustom: number;
  leagueAdjust?: LeagueAdjustAudit;
  signals: {
    cap: SignalResult;
    form: SignalResult;
    h2h: SignalResult;
    you: SignalResult;
    luck: SignalResult;
    lineup: SignalResult;
  };
  breakdown: string;
  dataSampleSize: number;
  statLayer?: {
    pCustom: number;
    pStat: number;
    pDc: number;
    pMl: number;
    scoreGrid?: number[][];
    lambdaHome?: number;
    lambdaAway?: number;
    mlProbs?: { home: number; draw: number; away: number };
    calibrated: boolean;
    bayesianLayer?: {
      pMarket: number;
      pLo: number;
      pHi: number;
      intervalWidth: number;
      confidence: number;
      lambdaHome: number;
      lambdaAway: number;
    };
  };
}

export interface PFinalResult {
  pFinal: number;
  pSignal: number;
  rBatch: number;
  rOdds: number;
  rLoss: number;
  band: ConfidenceBand;
}

const { K_fullTrustSampleSize, baseWeights, odds: oddsConfig, lambda_riskSensitivity } = FORMULA_CONFIG;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function reliability(sampleSize: number): number {
  return clamp01(sampleSize / K_fullTrustSampleSize);
}

// --- Signal 1: Capacity Edge ---

export function computeCapacityEdge(
  homeCap: ClubCapacity | null,
  awayCap: ClubCapacity | null,
  venue: "home" | "away",
  marketKey: LogMarketKey
): SignalResult {
  if (!homeCap || !awayCap) return { value: 0.5, reliability: 0 };

  const mapping: CapacityFieldMapping | undefined = CAPACITY_FIELD_MAP[marketKey];
  if (!mapping) return { value: 0.5, reliability: 0 };

  const attack = mapping.attackField(homeCap, venue);
  const defense = mapping.defenseField(awayCap, venue === "home" ? "away" : "home");
  const rawEdge = attack - defense;
  const value = 0.5 + 0.5 * Math.tanh(rawEdge / mapping.scale);

  return {
    value,
    reliability: reliability(Math.min(homeCap.sampleSize, awayCap.sampleSize)),
  };
}

// --- Signal 2: Recent Form ---

export function computeFormSignal(
  homeCap: ClubCapacity | null,
  awayCap: ClubCapacity | null
): SignalResult {
  if (!homeCap || !awayCap) return { value: 0.5, reliability: 0 };

  const homeForm = homeCap.recentForm / 10;
  const awayForm = awayCap.recentForm / 10;
  const value = clamp01(homeForm * 0.6 + (1 - awayForm) * 0.4);

  return {
    value,
    reliability: reliability(Math.min(homeCap.sampleSize, awayCap.sampleSize)),
  };
}

// --- Signal 3: Head-to-Head ---

function resolvedEntries(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.filter(
    (e) => !e.superseded && (e.result === "hit" || e.result === "miss")
  );
}

export function computeH2HSignal(
  homeRecord: ClubRecord | null,
  awayRecord: ClubRecord | null,
  marketKey: LogMarketKey
): SignalResult {
  if (!homeRecord || !awayRecord) return { value: 0.5, reliability: 0 };

  const histType = marketToHistoryType(marketKey);
  if (!histType) return { value: 0.5, reliability: 0 };

  const awayName = awayRecord.clubName.toLowerCase();
  const homeName = homeRecord.clubName.toLowerCase();

  const homeEntries = resolvedEntries(homeRecord.histories[histType]).filter(
    (e) => e.opponentName.toLowerCase() === awayName
  );
  const awayEntries = resolvedEntries(awayRecord.histories[histType]).filter(
    (e) => e.opponentName.toLowerCase() === homeName
  );

  const all = [...homeEntries, ...awayEntries];
  const uniqueIds = new Set(all.map((e) => e.matchId));
  const deduped: HistoryEntry[] = [];
  for (const e of all) {
    if (uniqueIds.has(e.matchId)) {
      deduped.push(e);
      uniqueIds.delete(e.matchId);
    }
  }

  if (deduped.length === 0) return { value: 0.5, reliability: 0 };

  const hits = deduped.filter((e) => e.result === "hit").length;
  const value = hits / deduped.length;

  return {
    value,
    reliability: reliability(deduped.length),
  };
}

// --- Signal 4: Your Personal Accuracy ---

export function computeYourAccuracy(
  analysis: AnalysisHistory | null,
  marketKey: LogMarketKey
): SignalResult {
  if (!analysis) return { value: 0.5, reliability: 0 };

  const stats = analysis.marketAccuracy[marketKey];
  if (!stats) return { value: 0.5, reliability: 0 };

  const sample = stats.correct + stats.wrong;
  if (sample === 0) return { value: 0.5, reliability: 0 };

  return {
    value: (stats.pct ?? 50) / 100,
    reliability: reliability(sample),
  };
}

// --- Signal 5: Lucky Number Nudge ---

export function computeLuckySignal(
  odds: number | undefined,
  luckyNumbers: number[]
): SignalResult {
  if (!odds || !luckyNumbers.length) return { value: 0.5, reliability: 0 };

  const matches = oddsMatchesLuckyNumber(odds, luckyNumbers);
  if (!matches) return { value: 0.5, reliability: 0 };

  return {
    value: 0.5 + FORMULA_CONFIG.luckMaxInfluence,
    reliability: 1,
  };
}

// --- Blending ---

export function blendSignals(signals: {
  cap: SignalResult;
  form: SignalResult;
  h2h: SignalResult;
  you: SignalResult;
  luck: SignalResult;
  lineup: SignalResult;
}): number {
  const weights = baseWeights;
  const entries: [number, SignalResult][] = [
    [weights.cap, signals.cap],
    [weights.form, signals.form],
    [weights.h2h, signals.h2h],
    [weights.you, signals.you],
    [weights.luck, signals.luck],
    [weights.lineup, signals.lineup],
  ];

  let weightedSum = 0;
  let totalWeight = 0;
  for (const [base, sig] of entries) {
    const w = base * sig.reliability;
    weightedSum += w * sig.value;
    totalWeight += w;
  }

  if (totalWeight === 0) return 50;
  return Math.round(Math.max(0, Math.min(100, (weightedSum / totalWeight) * 100)));
}

/**
 * Blend signals with a user confidence fallback for cold starts.
 * When all signals have zero reliability, the user's entered confidence
 * pulls the result away from 50 (but dampened toward uncertainty).
 */
export function blendSignalsWithFallback(
  signals: {
    cap: SignalResult;
    form: SignalResult;
    h2h: SignalResult;
    you: SignalResult;
    luck: SignalResult;
    lineup: SignalResult;
  },
  userConfidence: number
): number {
  const raw = blendSignals(signals);
  const totalReliability =
    signals.cap.reliability +
    signals.form.reliability +
    signals.h2h.reliability +
    signals.you.reliability +
    signals.luck.reliability +
    signals.lineup.reliability;
  if (totalReliability > 0) return raw;
  return Math.round(50 + (userConfidence - 50) * 0.3);
}

function totalDataSampleSize(signals: {
  cap: SignalResult;
  form: SignalResult;
  h2h: SignalResult;
  you: SignalResult;
}): number {
  let total = 0;
  for (const sig of [signals.cap, signals.form, signals.h2h, signals.you]) {
    total += Math.round(sig.reliability * K_fullTrustSampleSize);
  }
  return total;
}

// --- Orchestrator ---

function resolveClubRecordByName(
  ctx: RecommendationContext,
  clubName: string,
  clubId?: string
): ClubRecord | null {
  if (clubId && ctx.clubRecords?.[clubId]) return ctx.clubRecords[clubId]!;
  if (!ctx.clubRecords || !ctx.clubIndex) return null;
  const norm = clubName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const entry = ctx.clubIndex.clubs.find(
    (e) => e.normalizedName === norm && e.league === ctx.league
  );
  if (!entry) return null;
  return ctx.clubRecords[entry.clubId] ?? null;
}

export function computeMasterProbability(
  ctx: RecommendationContext,
  match: LogMatch,
  marketKey: LogMarketKey,
  pick: MarketPrediction,
  luckyNumbers: number[] = []
): MasterProbabilityResult {
  const homeRecord = resolveClubRecordByName(ctx, match.homeTeam, match.homeClubId);
  const awayRecord = resolveClubRecordByName(ctx, match.awayTeam, match.awayClubId);
  const homeCap = homeRecord?.capacity ?? null;
  const awayCap = awayRecord?.capacity ?? null;

  const cap = computeCapacityEdge(homeCap, awayCap, "home", marketKey);
  const form = computeFormSignal(homeCap, awayCap);
  const h2h = computeH2HSignal(homeRecord, awayRecord, marketKey);
  const you = computeYourAccuracy(ctx.analysis, marketKey);
  const luck = computeLuckySignal(pick.odds, luckyNumbers);
  const lineup = computeLineupContextSignal(homeRecord, awayRecord);

  const signals = { cap, form, h2h, you, luck, lineup };
  const pCustom = blendSignalsWithFallback(signals, pick.confidence);
  const dataSampleSize = totalDataSampleSize(signals);
  const minSample = Math.min(homeCap?.sampleSize ?? 0, awayCap?.sampleSize ?? 0);

  let pStat = 50;
  let pDc = 50;
  let pMl = 50;
  let wasCalibrated = false;
  let statLayer: MasterProbabilityResult["statLayer"];

  try {
    const dcResult = computeDixonColes(
      homeRecord,
      awayRecord,
      ctx.league,
      marketKey,
      pick.prediction,
      pick.line,
      ctx.leagueBaselines ?? null,
      ctx.leagueCharacterProfile ?? null
    );
    const features = buildInferenceFeatures(
      match,
      homeRecord,
      awayRecord,
      ctx.analysis,
      ctx.teamsQuality ?? null,
      ctx.matchupCaches ?? {}
    );
    const mlProbs = predictMlOutcome(ctx.mlClassifier ?? null, features);
    const statParts = computePStat(dcResult, mlProbs, marketKey, pick.prediction, pick.line);
    pDc = statParts.pDc;
    pMl = statParts.pMl;
    pStat = shrinkPStat(statParts.pStat, minSample);
    const calibrator = ctx.binCalibrator ?? null;
    pStat = applyCalibration(pStat, calibrator);
    wasCalibrated = calibrator != null;

    let bayesianLayer:
      | {
          pMarket: number;
          pLo: number;
          pHi: number;
          intervalWidth: number;
          confidence: number;
          lambdaHome: number;
          lambdaAway: number;
        }
      | undefined;

    if (BAYESIAN_CONFIG.BAYESIAN_FEEDS_SIGNAL) {
      const bayes = computeBayesianMatchPrediction(
        homeRecord,
        awayRecord,
        ctx.league,
        ctx.leagueBaselines ?? null,
        ctx.teamsQuality ?? null,
        marketKey,
        pick.prediction,
        pick.line,
        BAYESIAN_CONFIG.MONTE_CARLO_SAMPLES_FAST
      );
      const est = bayes.marketEstimates[marketKey];
      if (est) {
        pStat = Math.round(est.point * 100);
        pDc = pStat;
        bayesianLayer = {
          pMarket: Math.round(est.point * 100),
          pLo: Math.round(est.lo * 100),
          pHi: Math.round(est.hi * 100),
          intervalWidth: est.intervalWidth,
          confidence: confidenceFromInterval(est.intervalWidth),
          lambdaHome: bayes.lambdaHome,
          lambdaAway: bayes.lambdaAway,
        };
      }
    }

    statLayer = {
      pCustom,
      pStat,
      pDc,
      pMl,
      scoreGrid: dcResult.scoreGrid,
      lambdaHome: dcResult.lambdaHome,
      lambdaAway: dcResult.lambdaAway,
      mlProbs,
      calibrated: wasCalibrated,
      bayesianLayer,
    };
  } catch {
    statLayer = { pCustom, pStat: 50, pDc: 50, pMl: 50, calibrated: false };
  }

  const blended = blendSignalWithStat(pStat, pCustom);
  const leagueAdj = applyLeagueAdjustToPSignal(
    blended,
    ctx.leagueCharacterProfile ?? null,
    marketKey
  );
  const pSignal = leagueAdj.pSignal;

  const parts: string[] = [];
  if (statLayer) {
    parts.push(`Stat ${pStat}% (DC ${pDc}%, ML ${pMl}%)`);
    if (wasCalibrated) parts.push("calibrated");
    parts.push(`Custom ${pCustom}%`);
  }
  if (cap.reliability > 0) parts.push(`Cap ${(cap.value * 100).toFixed(0)}%`);
  if (form.reliability > 0) parts.push(`Form ${(form.value * 100).toFixed(0)}%`);
  if (h2h.reliability > 0) parts.push(`H2H ${(h2h.value * 100).toFixed(0)}%`);
  if (you.reliability > 0) parts.push(`You ${(you.value * 100).toFixed(0)}%`);
  if (luck.reliability > 0) parts.push(`Luck +5%`);
  if (lineup.reliability > 0) parts.push(`XI ${(lineup.value * 100).toFixed(0)}%`);
  if (ctx.leagueCharacterProfile) parts.push("league");
  const breakdown =
    parts.length > 0
      ? `P_signal ${pSignal}% from: ${parts.join(", ")}. Based on ${dataSampleSize} data points.`
      : `P_signal ${pSignal}% — insufficient data, defaulting to uncertainty.`;

  return { pSignal, pCustom, leagueAdjust: leagueAdj.audit, signals, breakdown, dataSampleSize, statLayer };
}

// --- Batch Risk Brakes ---

export function computeROdds(totalOdds: number): number {
  return clamp01((totalOdds - oddsConfig.safeThreshold) / oddsConfig.spread);
}

export function computeRLoss(batchSize: number, batches: PredictionBatch[]): number {
  const rows = analyzeAllBatches(batches);
  let losses = 0;
  let total = 0;
  for (const row of rows) {
    if (row.batchWon == null) continue;
    if (row.matchCount === batchSize) {
      total++;
      if (!row.batchWon) losses++;
    }
  }
  if (total < 3) return 0;
  return losses / total;
}

export function computeRBatch(rOdds: number, rLoss: number): number {
  return 1 - (1 - rOdds) * (1 - rLoss);
}

export function computePFinal(pSignal: number, rBatch: number): number {
  return Math.round(Math.max(0, pSignal * (1 - lambda_riskSensitivity * rBatch)));
}

export function computePFinalResult(
  pSignal: number,
  totalOdds: number,
  batchSize: number,
  batches: PredictionBatch[]
): PFinalResult {
  const rOdds = computeROdds(totalOdds);
  const rLoss = computeRLoss(batchSize, batches);
  const rBatch = computeRBatch(rOdds, rLoss);
  const pFinal = computePFinal(pSignal, rBatch);
  return {
    pFinal,
    pSignal,
    rBatch,
    rOdds,
    rLoss,
    band: confidenceBand(pFinal),
  };
}
