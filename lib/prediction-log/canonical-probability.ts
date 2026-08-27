/**
 * Canonical probability entry point — cross-surface coherence.
 *
 * Audit (Surface × Market → source → compliant after this module):
 * - Survival Ladder / P(2H>1H) → half engine via this module (was two-h-heavy μ) → Y
 * - HSH / P(1H|2H|Tie) → same half engine (Stage A/B) via this module → Y
 * - Recommendation / pick % → ft_event route (master + weightedEstimate upstream) → partial wrap
 * - Combined Odds / combo % → composition of event probs (not rewritten here)
 * - Corners / O/U lean → corners_over route → predictCornersMatch
 * - Per-team lines → consumes λ from half/corners engines (no second λ)
 * - Decision Maker merge → WEIGHTING-EXEMPT (do not call weightedEstimate on merge)
 * - Risk page → N/A (bankroll metrics)
 *
 * Half source of truth: HSH attack×defence Stage A + tempo + Stage B.
 * Surfaces sort/filter only; ranking adjustments must not replace displayed model %.
 */

import {
  predictHighestScoringHalf,
  type HshMatchContext,
  type HshPrediction,
} from "@/lib/prediction-log/hsh-model";
import {
  predictCornersMatch,
  type CornersMatchPrediction,
} from "@/lib/prediction-log/corners-model";
import { MIN_MATCHES } from "@/lib/prediction-log/two-h-heavy/config";
import { computeConfidence } from "@/lib/prediction-log/two-h-heavy/poisson-half";
import type {
  MatchDataSource,
  TeamHalfProfile,
  TwoHHeavyResult,
} from "@/lib/prediction-log/two-h-heavy/types";
import {
  weightedEstimate,
  type BlendSource,
} from "@/lib/prediction-log/prediction-weights";
import type { PredictionBatch } from "@/lib/prediction-log/types";
import {
  resolveCfeLegProbability,
  type CfeLegEstimateSlice,
} from "@/lib/prediction-log/cfe-leg-probability";
import type { MarketFamilyId } from "@/lib/slip-builder/types";

export type CanonicalMarket =
  | "hsh_1h"
  | "hsh_2h"
  | "hsh_tie"
  | "hsh_2h_gt_1h"
  | "corners_over"
  | "ft_event"
  | "cfe_leg";

export type CanonicalProbabilityResult = {
  prob: number;
  lambdaH: number | null;
  lambdaA: number | null;
  sampleSize: number | null;
  sourceBreakdown: BlendSource;
  apiWeight: number;
  manualAiWeight: number;
  computedAt: string;
  market: CanonicalMarket;
  meta?: Record<string, unknown>;
};

export type CanonicalHalfInput = {
  market: "hsh_1h" | "hsh_2h" | "hsh_tie" | "hsh_2h_gt_1h";
  ctx: HshMatchContext;
  /**
   * @deprecated Probability-level blend removed. Manual/AI must blend at λ
   * via canonicalFixtureEstimate.manualLambdas.
   */
  manualAiProb?: number | null;
};

export type CanonicalCornersInput = {
  market: "corners_over";
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  batches: PredictionBatch[];
  beforeDate?: string;
  line?: 9.5 | 10.5;
  manualAiProb?: number | null;
};

export type CanonicalFtEventInput = {
  market: "ft_event";
  /** Already-computed API/DB-derived probability (0–1 or 0–100). */
  apiProb: number | null | undefined;
  manualAiProb?: number | null | undefined;
  /** If values look like percents (>1.5), treat as 0–100. */
  scale?: "unit" | "percent" | "auto";
  fixtureKey?: string;
  meta?: Record<string, unknown>;
};

export type CanonicalCfeLegInput = {
  market: "cfe_leg";
  estimate: CfeLegEstimateSlice;
  family: MarketFamilyId;
  selectionKey: string;
  line?: number | null;
  comboId?: string | null;
  fixtureKey?: string;
};

export type CanonicalProbabilityInput =
  | CanonicalHalfInput
  | CanonicalCornersInput
  | CanonicalFtEventInput
  | CanonicalCfeLegInput;

function assertUnitProb(prob: number, market: CanonicalMarket): void {
  if (!(prob >= 0 && prob <= 1) || !Number.isFinite(prob)) {
    throw new Error(
      `canonicalProbability: prob out of range for ${market}: ${prob}`
    );
  }
}

function toUnit(
  n: number | null | undefined,
  scale: "unit" | "percent" | "auto"
): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (scale === "percent") return n / 100;
  if (scale === "unit") return n;
  return n > 1.5 ? n / 100 : n;
}

function packResult(params: {
  market: CanonicalMarket;
  apiProb: number;
  manualAiProb?: number | null;
  lambdaH?: number | null;
  lambdaA?: number | null;
  sampleSize?: number | null;
  meta?: Record<string, unknown>;
  fixtureKey?: string;
}): CanonicalProbabilityResult {
  // Anti-pattern: never blend probabilities. 60/40 applies to λ inputs only
  // (canonicalFixtureEstimate). manualAiProb is ignored for the returned prob.
  void params.manualAiProb;
  void weightedEstimate;
  const blend = {
    value: params.apiProb,
    source: "api_only" as const,
    apiWeight: 1,
    manualAiWeight: 0,
  };
  const prob = blend.value;
  assertUnitProb(prob, params.market);
  const computedAt = new Date().toISOString();
  const result: CanonicalProbabilityResult = {
    prob,
    lambdaH: params.lambdaH ?? null,
    lambdaA: params.lambdaA ?? null,
    sampleSize: params.sampleSize ?? null,
    sourceBreakdown: blend?.source ?? "api_only",
    apiWeight: blend?.apiWeight ?? 1,
    manualAiWeight: blend?.manualAiWeight ?? 0,
    computedAt,
    market: params.market,
    meta: params.meta,
  };
  console.debug("[canonicalProbability]", {
    fixture: params.fixtureKey ?? params.meta?.matchId ?? null,
    market: params.market,
    lambdaH: result.lambdaH,
    lambdaA: result.lambdaA,
    prob: result.prob,
    sourceBreakdown: result.sourceBreakdown,
  });
  return result;
}

/** Run HSH engine once (sole half λ/prob implementation). */
export function computeCanonicalHshPrediction(
  ctx: HshMatchContext
): HshPrediction {
  return predictHighestScoringHalf(ctx);
}

export function canonicalProbabilityFromHsh(
  pred: HshPrediction,
  market: CanonicalHalfInput["market"],
  manualAiProb?: number | null
): CanonicalProbabilityResult {
  const apiProb =
    market === "hsh_1h"
      ? pred.p1h
      : market === "hsh_2h" || market === "hsh_2h_gt_1h"
        ? pred.p2h
        : pred.pTie;
  return packResult({
    market,
    apiProb,
    manualAiProb,
    lambdaH: pred.lambda1h,
    lambdaA: pred.lambda2h,
    sampleSize: Math.min(pred.sampleSizeHome, pred.sampleSizeAway),
    fixtureKey: pred.matchId,
    meta: {
      matchId: pred.matchId,
      p1h: pred.p1h,
      p2h: pred.p2h,
      pTie: pred.pTie,
      usedManualOverride: pred.usedManualOverride,
    },
  });
}

/**
 * Single entry for all analysis-surface probability reads.
 * Half markets always go through predictHighestScoringHalf.
 */
export function canonicalProbability(
  input: CanonicalProbabilityInput
): CanonicalProbabilityResult {
  if (input.market === "cfe_leg") {
    const resolved = resolveCfeLegProbability({
      estimate: input.estimate,
      family: input.family,
      selectionKey: input.selectionKey,
      line: input.line,
      comboId: input.comboId,
    });
    if (!resolved.available) {
      throw new Error(
        `canonicalProbability(cfe_leg): ${resolved.reason ?? "unavailable"}`
      );
    }
    return packResult({
      market: "cfe_leg",
      apiProb: resolved.prob,
      lambdaH: input.estimate.lambdas.home,
      lambdaA: input.estimate.lambdas.away,
      sampleSize: resolved.nEffective,
      fixtureKey: input.fixtureKey,
      meta: {
        family: input.family,
        selectionKey: input.selectionKey,
        line: input.line ?? null,
        comboId: input.comboId ?? null,
        rawProb: resolved.prob,
        coherenceOk: resolved.coherenceOk,
        nEffective: resolved.nEffective,
        handicapSource: resolved.handicapSource,
        handicapN: resolved.handicapN,
        expectedDiff: resolved.expectedDiff,
        canonicalLine: resolved.canonicalLine,
      },
    });
  }

  if (input.market === "ft_event") {
    const scale = input.scale ?? "auto";
    const api = toUnit(input.apiProb, scale);
    const manual = toUnit(input.manualAiProb, scale);
    if (api == null && manual == null) {
      throw new Error("canonicalProbability(ft_event): no probability provided");
    }
    const apiProb = api ?? manual!;
    return packResult({
      market: "ft_event",
      apiProb,
      manualAiProb: api != null ? manual : null,
      fixtureKey: input.fixtureKey,
      meta: input.meta,
    });
  }

  if (input.market === "corners_over") {
    const pred = predictCornersMatch({
      matchId: input.matchId,
      homeTeam: input.homeTeam,
      awayTeam: input.awayTeam,
      league: input.league,
      batches: input.batches,
      beforeDate: input.beforeDate,
    });
    const line = input.line ?? 9.5;
    const apiProb = line === 10.5 ? pred.pOver105 : pred.pOver95;
    return packResult({
      market: "corners_over",
      apiProb,
      manualAiProb: input.manualAiProb,
      lambdaH: pred.lambdaHome,
      lambdaA: pred.lambdaAway,
      sampleSize: null,
      fixtureKey: input.matchId,
      meta: {
        matchId: input.matchId,
        lean: pred.lean,
        pUnder95: pred.pUnder95,
        topProbability: pred.topProbability,
      },
    });
  }

  const pred = computeCanonicalHshPrediction(input.ctx);
  return canonicalProbabilityFromHsh(pred, input.market, input.manualAiProb);
}

function stubProfile(
  team: string,
  venue: "home" | "away",
  n: number
): TeamHalfProfile {
  return {
    team,
    venue,
    sc_1h: 0,
    sc_2h: 0,
    conc_1h: 0,
    conc_2h: 0,
    n_matches: n,
    last_match_date: null,
    source: "db",
  };
}

/**
 * Ladder-compatible row from canonical HSH prediction.
 * Displayed p_* come from Stage B; confidence is a rank-score factor only
 * (sample × recency × p, matching prior ladder confidence formula shape).
 */
export function hshPredictionToLadderResult(
  pred: HshPrediction,
  opts?: {
    nowMs?: number;
    sourceBreakdown?: BlendSource;
    apiWeight?: number;
    manualAiWeight?: number;
  }
): TwoHHeavyResult & {
  sourceBreakdown: BlendSource;
  apiWeight: number;
  manualAiWeight: number;
} {
  const canon = canonicalProbabilityFromHsh(
    pred,
    "hsh_2h_gt_1h"
  );
  const p2h = canon.prob;
  const p1h = pred.p1h;
  const pTie = pred.pTie;
  // Keep three-way identity after optional 60/40 on p2h alone is rare;
  // when no manual blend, p2h === pred.p2h and sum stays 1.
  const confidence = computeConfidence(
    p2h,
    pred.sampleSizeHome,
    pred.sampleSizeAway,
    null,
    null,
    opts?.nowMs
  );
  const thinData =
    pred.sampleSizeHome < MIN_MATCHES || pred.sampleSizeAway < MIN_MATCHES;
  const data_source: MatchDataSource = pred.usedManualOverride ? "db" : "db";

  return {
    matchId: pred.matchId,
    homeTeam: pred.homeTeam,
    awayTeam: pred.awayTeam,
    league: pred.league,
    p_2h_gt_1h: p2h,
    p_2h_eq_1h: pTie,
    p_2h_lt_1h: p1h,
    expected_1h: pred.lambda1h,
    expected_2h: pred.lambda2h,
    confidence,
    data_source,
    thinData,
    partlyFromApi: false,
    insufficientData: thinData && pred.sampleSizeHome + pred.sampleSizeAway === 0,
    homeProfile: stubProfile(pred.homeTeam, "home", pred.sampleSizeHome),
    awayProfile: stubProfile(pred.awayTeam, "away", pred.sampleSizeAway),
    live: false,
    sourceBreakdown: opts?.sourceBreakdown ?? canon.sourceBreakdown,
    apiWeight: opts?.apiWeight ?? canon.apiWeight,
    manualAiWeight: opts?.manualAiWeight ?? canon.manualAiWeight,
  };
}

/** Sort helper: same compare as former two-h-heavy rank (p×conf). */
export function compareCanonicalLadderDesc(
  a: TwoHHeavyResult,
  b: TwoHHeavyResult
): number {
  const sa = a.p_2h_gt_1h * a.confidence;
  const sb = b.p_2h_gt_1h * b.confidence;
  if (sb !== sa) return sb - sa;
  if (b.p_2h_gt_1h !== a.p_2h_gt_1h) return b.p_2h_gt_1h - a.p_2h_gt_1h;
  return a.matchId.localeCompare(b.matchId);
}

/** Corners surface entry: prediction + canonical Over 9.5 envelope (single λ pass). */
export function canonicalCornersMatch(params: {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  batches: PredictionBatch[];
  beforeDate?: string;
  manualAiProb?: number | null;
}): {
  prediction: CornersMatchPrediction;
  canonical: CanonicalProbabilityResult;
} {
  const prediction = predictCornersMatch(params);
  const canonical = packResult({
    market: "corners_over",
    apiProb: prediction.pOver95,
    manualAiProb: params.manualAiProb,
    lambdaH: prediction.lambdaHome,
    lambdaA: prediction.lambdaAway,
    fixtureKey: params.matchId,
    meta: {
      matchId: params.matchId,
      lean: prediction.lean,
      pUnder95: prediction.pUnder95,
      topProbability: prediction.topProbability,
    },
  });
  return { prediction, canonical };
}
