/**
 * Single source of truth for fixture estimates.
 * Blend λ inputs (60/40) → one FT score matrix + half joint → all markets.
 * Decision Maker merge/settlement must NOT call this for page-weighting.
 */
import {
  computeCanonicalHshPrediction,
  hshPredictionToLadderResult,
  compareCanonicalLadderDesc,
  type CanonicalProbabilityResult,
} from "./canonical-probability";
import {
  computeAttackDefenceStageA,
  computeStageB,
  type HshMatchContext,
} from "./hsh-model";
import { predictCornersMatch } from "./corners-model";
import {
  clampLambda,
  HALF_SUM_FT_TOLERANCE,
  MODEL_PARAMS_VERSION,
  SCORE_MATRIX_MAX_GOALS,
  shrinkRateTowardLeague,
  SHRINKAGE_K,
} from "./model-config";
import {
  bttsYesNo,
  computeGoalDistribution,
  overUnderFromGoalMatrix,
} from "./goal-distribution";
import { outcomeProbsFromMatrix } from "@/lib/predictor/score-matrix";
import { weightedEstimate, type BlendSource } from "./prediction-weights";
import {
  defaultModelParams,
  loadModelParams,
  type ModelParamsStore,
} from "@/lib/hist/model-params";
import {
  getCachedHalfParams,
  lookupHalfParams,
  type HalfParamsStore,
  type LeagueHalfParams,
} from "@/lib/hist/half-params-types";
import { HIST_LEAGUES } from "@/lib/hist/seasons";
import { apiLeagueId } from "@/lib/football-api/leagues";
import { computeDiehMarkets, type DiehMarkets } from "./dieh-probability";
import {
  buildTotalGoalsMarkets,
  type TotalGoalsMarkets,
} from "./total-goals-markets";
import { matchLeague } from "./match-league";
import {
  loadClubHalfAttackDefence,
  loadLeagueAfBaselines,
} from "./hsh-half-rates";
import { estimateTempoProfile } from "./half-tempo";
import type { TwoHHeavyResult } from "./two-h-heavy/types";
import type { PredictionBatch } from "./types";

export type CanonicalFixtureEstimate = {
  lambdas: {
    home: number;
    away: number;
    home_1h: number;
    away_1h: number;
    home_2h: number;
    away_2h: number;
    home_corners: number;
    away_corners: number;
  };
  score_matrix: number[][];
  markets: {
    home: number;
    draw: number;
    away: number;
    bttsYes: number;
    bttsNo: number;
    over25: number;
    under25: number;
    over25_push?: number;
    p1h: number;
    p2h: number;
    pTie: number;
    p2h_gt_1h: number;
    cornersOver95: number;
    cornersUnder95: number;
    doubleChance: { oneX: number; xTwo: number; oneTwo: number };
    dieh: DiehMarkets;
    totalGoals: TotalGoalsMarkets;
  };
  provenance: {
    api_pct: number;
    manual_pct: number;
    ai_pct: number;
    seasons_used: number;
    matches_used: number;
    ess: number;
    sourceBreakdown: "blended" | "api_only" | "manual_ai_only";
  };
  coverage: { ht_pct: number | null; corners_pct: number | null };
  confidence_tier: "high" | "medium" | "low";
  model_params_version: string;
  rho: number;
  diagnostics: {
    lambda1hPlus2h: number;
    lambdaFt: number;
    halfSumOk: boolean;
  };
};

export type CanonicalFixtureInput = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  batches: PredictionBatch[];
  beforeDate?: string;
  hshCtx: HshMatchContext;
  /** Optional manual/AI λ overrides (blended at INPUT level, not on P). */
  manualLambdas?: {
    home?: number | null;
    away?: number | null;
  } | null;
  coverage?: { ht_pct?: number | null; corners_pct?: number | null };
};

const cache = new Map<string, CanonicalFixtureEstimate>();

export function clearCanonicalFixtureCache(): void {
  cache.clear();
}

function blendLambda(
  api: number,
  manual: number | null | undefined
): { value: number; source: "blended" | "api_only" | "manual_ai_only"; apiW: number; manW: number } {
  if (manual != null && Number.isFinite(manual)) {
    const b = weightedEstimate(api, manual);
    return {
      value: b?.value ?? api,
      source: b?.source ?? "blended",
      apiW: b?.apiWeight ?? 0.6,
      manW: b?.manualAiWeight ?? 0.4,
    };
  }
  return { value: api, source: "api_only", apiW: 1, manW: 0 };
}

let cachedParams: ModelParamsStore | null = null;

/** Warm client/server cache of fitted model params (optional). */
export function setCachedModelParams(params: ModelParamsStore | null): void {
  cachedParams = params;
  clearCanonicalFixtureCache();
}

function resolveLeagueHalfParams(
  leagueName: string,
  halfParamsStore?: HalfParamsStore | null
): LeagueHalfParams | null {
  const store = halfParamsStore ?? getCachedHalfParams();
  const leagueId = apiLeagueId(leagueName);
  const def = HIST_LEAGUES.find((l) => l.name === leagueName);
  const compType = def?.type ?? "league";
  return lookupHalfParams(store, leagueId, compType);
}

/**
 * Sync canonical estimate for UI surfaces (uses cached/default model params).
 */
export function canonicalFixtureEstimateSync(
  input: CanonicalFixtureInput,
  opts?: {
    skipCache?: boolean;
    modelParams?: ModelParamsStore;
    halfParamsStore?: HalfParamsStore | null;
  }
): CanonicalFixtureEstimate {
  const params =
    opts?.modelParams ?? cachedParams ?? defaultModelParams();
  const halfStore = opts?.halfParamsStore ?? getCachedHalfParams();
  const halfFittedAt = halfStore?.fittedAt ?? "none";
  const cacheKey = [
    input.matchId,
    input.homeTeam,
    input.awayTeam,
    input.league,
    params.version,
    params.fittedAt,
    halfFittedAt,
    input.manualLambdas?.home ?? "",
    input.manualLambdas?.away ?? "",
  ].join("|");

  if (!opts?.skipCache) {
    const hit = cache.get(cacheKey);
    if (hit) return hit;
  }

  const stageA = computeAttackDefenceStageA({
    home: input.hshCtx.homeRates,
    away: input.hshCtx.awayRates,
    lgAf1: input.hshCtx.lgAf1,
    lgAf2: input.hshCtx.lgAf2,
  });

  let apiHome = clampLambda(stageA.lambdaA1 + stageA.lambdaA2, "λ_home_api");
  let apiAway = clampLambda(stageA.lambdaB1 + stageA.lambdaB2, "λ_away_api");

  const nEff = Math.min(
    input.hshCtx.homeRates.nMatches,
    input.hshCtx.awayRates.nMatches
  );
  const muHome = input.hshCtx.lgAf1 + input.hshCtx.lgAf2;
  const muAway = muHome;
  apiHome = clampLambda(
    shrinkRateTowardLeague(apiHome, nEff, muHome, SHRINKAGE_K),
    "λ_home"
  );
  apiAway = clampLambda(
    shrinkRateTowardLeague(apiAway, nEff, muAway, SHRINKAGE_K),
    "λ_away"
  );

  const homeBlend = blendLambda(apiHome, input.manualLambdas?.home);
  const awayBlend = blendLambda(apiAway, input.manualLambdas?.away);
  const lambdaHome = clampLambda(homeBlend.value, "λ_home_blended");
  const lambdaAway = clampLambda(awayBlend.value, "λ_away_blended");

  const hsh = computeCanonicalHshPrediction(input.hshCtx);
  const halfProbs = computeStageB(hsh.lambda1h, hsh.lambda2h);

  const dist = computeGoalDistribution(lambdaHome, lambdaAway, {
    rho: params.rho,
    maxGoals: SCORE_MATRIX_MAX_GOALS,
  });
  const { home, draw, away } = outcomeProbsFromMatrix(dist.matrix);
  const [bttsYes, bttsNo] = bttsYesNo(dist.matrix);
  const [over25, under25] = overUnderFromGoalMatrix(dist.matrix, 2.5);

  const leagueHalf = resolveLeagueHalfParams(input.league, halfStore);
  const dieh = computeDiehMarkets({
    lambdaHome,
    lambdaAway,
    halfParams: leagueHalf,
  });

  const totalGoals = buildTotalGoalsMarkets({
    lambdaHome,
    lambdaAway,
    rho: params.rho,
    maxGoals: SCORE_MATRIX_MAX_GOALS,
    distributionFamily: leagueHalf?.goalsDistribution ?? "poisson",
    dispersion: leagueHalf?.goalsDispersion ?? null,
  });

  // Cross-surface identity: markets.over25 must match totalGoals lines[2.5].
  // Prefer DC-matrix O/U when poisson; NegBin path uses totalGoals lines.
  const useNegBin =
    (leagueHalf?.goalsDistribution ?? "poisson") === "negbin" &&
    leagueHalf?.goalsDispersion != null &&
    leagueHalf.goalsDispersion > 1;
  const over25Aligned = useNegBin ? totalGoals.lines[2.5].over : over25;
  const under25Aligned = useNegBin ? totalGoals.lines[2.5].under : under25;

  const corners = predictCornersMatch({
    matchId: input.matchId,
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    league: input.league,
    batches: input.batches,
    beforeDate: input.beforeDate,
  });

  const seasonsUsed = Math.max(
    input.hshCtx.homeRates.seasonCount,
    input.hshCtx.awayRates.seasonCount
  );
  const matchesUsed =
    input.hshCtx.homeRates.nMatches + input.hshCtx.awayRates.nMatches;
  const ess = nEff;

  const lambdaFt = lambdaHome + lambdaAway;
  const lambda1hPlus2h = hsh.lambda1h + hsh.lambda2h;
  const halfSumOk =
    lambdaFt <= 0 ||
    Math.abs(lambda1hPlus2h / lambdaFt - 1) <= HALF_SUM_FT_TOLERANCE + 0.15;

  let confidence_tier: "high" | "medium" | "low" = "medium";
  if (hsh.confidence === "high" || hsh.confidence === "low") {
    confidence_tier = hsh.confidence;
  }
  if (dieh.status === "insufficient" || (dieh.nValid > 0 && dieh.nValid < 400)) {
    if (confidence_tier === "high") confidence_tier = "medium";
  }

  const source =
    homeBlend.source === "blended" || awayBlend.source === "blended"
      ? "blended"
      : homeBlend.source;

  // When NegBin is active, rewrite totalGoals.lines from NegBin PMF already done;
  // when Poisson, keep totalGoals from DC path but force 2.5 identity with markets.
  if (!useNegBin) {
    totalGoals.lines[2.5] = { over: over25Aligned, under: under25Aligned };
  }

  const estimate: CanonicalFixtureEstimate = {
    lambdas: {
      home: lambdaHome,
      away: lambdaAway,
      home_1h: stageA.lambdaA1,
      away_1h: stageA.lambdaB1,
      home_2h: stageA.lambdaA2,
      away_2h: stageA.lambdaB2,
      home_corners: corners.lambdaHome,
      away_corners: corners.lambdaAway,
    },
    score_matrix: dist.matrix,
    markets: {
      home,
      draw,
      away,
      bttsYes,
      bttsNo,
      over25: over25Aligned,
      under25: under25Aligned,
      // 2.5 is a half-line (no push). Whole-line push mass is covered by overUnderPushFromPmf tests.
      over25_push: undefined,
      p1h: halfProbs.p1h,
      p2h: halfProbs.p2h,
      pTie: halfProbs.pTie,
      p2h_gt_1h: halfProbs.p2h,
      cornersOver95: corners.pOver95,
      cornersUnder95: corners.pUnder95,
      doubleChance: {
        oneX: home + draw,
        xTwo: draw + away,
        oneTwo: home + away,
      },
      dieh,
      totalGoals,
    },
    provenance: {
      api_pct: source === "manual_ai_only" ? 0 : homeBlend.apiW * 100,
      manual_pct: homeBlend.manW * 100,
      ai_pct: homeBlend.manW * 100,
      seasons_used: seasonsUsed,
      matches_used: matchesUsed,
      ess,
      sourceBreakdown: source,
    },
    coverage: {
      ht_pct: input.coverage?.ht_pct ?? null,
      corners_pct: input.coverage?.corners_pct ?? null,
    },
    confidence_tier,
    model_params_version: params.version || MODEL_PARAMS_VERSION,
    rho: params.rho,
    diagnostics: {
      lambda1hPlus2h,
      lambdaFt,
      halfSumOk,
    },
  };

  cache.set(cacheKey, estimate);
  return estimate;
}

/**
 * Canonical fixture estimate — all display surfaces should read markets from here.
 */
export async function canonicalFixtureEstimate(
  input: CanonicalFixtureInput,
  opts?: {
    skipCache?: boolean;
    modelParams?: ModelParamsStore;
    halfParamsStore?: HalfParamsStore | null;
  }
): Promise<CanonicalFixtureEstimate> {
  const params =
    opts?.modelParams ??
    cachedParams ??
    (await loadModelParams().catch(() => defaultModelParams()));
  cachedParams = params;
  let halfStore = opts?.halfParamsStore ?? getCachedHalfParams();
  if (!halfStore) {
    try {
      const { loadHalfParamsStore } = await import("@/lib/hist/half-params");
      halfStore = await loadHalfParamsStore();
    } catch {
      halfStore = null;
    }
  }
  return canonicalFixtureEstimateSync(input, {
    skipCache: opts?.skipCache,
    modelParams: params,
    halfParamsStore: halfStore,
  });
}

/** One-pass batch estimates for ladder / reco (no per-match engine hop). */
export function estimateBatchCanonical(
  batch: PredictionBatch,
  allBatches: PredictionBatch[],
  opts?: {
    modelParams?: ModelParamsStore;
    halfParamsStore?: HalfParamsStore | null;
  }
): CanonicalFixtureEstimate[] {
  const params = opts?.modelParams ?? cachedParams ?? defaultModelParams();
  const halfStore = opts?.halfParamsStore ?? getCachedHalfParams();
  return batch.matches.map((match) => {
    const league = matchLeague(match, batch.league);
    const homeRates = loadClubHalfAttackDefence(
      match.homeTeam,
      league,
      allBatches,
      { beforeDate: batch.date }
    );
    const awayRates = loadClubHalfAttackDefence(
      match.awayTeam,
      league,
      allBatches,
      { beforeDate: batch.date }
    );
    const { lgAf1, lgAf2 } = loadLeagueAfBaselines(league);
    return canonicalFixtureEstimateSync(
      {
        matchId: match.id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        league,
        batches: allBatches,
        beforeDate: batch.date,
        hshCtx: {
          matchId: match.id,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          league,
          homeRates,
          awayRates,
          lgAf1,
          lgAf2,
          homeTempo: estimateTempoProfile(allBatches, match.homeTeam, {
            beforeDate: batch.date,
          }),
          awayTempo: estimateTempoProfile(allBatches, match.awayTeam, {
            beforeDate: batch.date,
          }),
        },
      },
      { modelParams: params, halfParamsStore: halfStore }
    );
  });
}

export type LadderRankFromCfe = TwoHHeavyResult & {
  sourceBreakdown: BlendSource;
  apiWeight: number;
  manualAiWeight: number;
  estimate: CanonicalFixtureEstimate;
};

/** Ladder legs from canonical fixture estimates (batch). */
export function ladderRanksFromBatchEstimates(
  estimates: CanonicalFixtureEstimate[],
  batch: PredictionBatch,
  allBatches: PredictionBatch[]
): LadderRankFromCfe[] {
  const rows: LadderRankFromCfe[] = estimates.map((est, i) => {
    const match = batch.matches[i]!;
    const league = matchLeague(match, batch.league);
    const homeRates = loadClubHalfAttackDefence(
      match.homeTeam,
      league,
      allBatches,
      { beforeDate: batch.date }
    );
    const awayRates = loadClubHalfAttackDefence(
      match.awayTeam,
      league,
      allBatches,
      { beforeDate: batch.date }
    );
    const { lgAf1, lgAf2 } = loadLeagueAfBaselines(league);
    const pred = computeCanonicalHshPrediction({
      matchId: match.id,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      league,
      homeRates,
      awayRates,
      lgAf1,
      lgAf2,
      homeTempo: estimateTempoProfile(allBatches, match.homeTeam, {
        beforeDate: batch.date,
      }),
      awayTempo: estimateTempoProfile(allBatches, match.awayTeam, {
        beforeDate: batch.date,
      }),
    });
    // Force displayed half probs from CFE markets (identity with HSH Stage B).
    const aligned = {
      ...pred,
      p1h: est.markets.p1h,
      p2h: est.markets.p2h,
      pTie: est.markets.pTie,
      topProbability: Math.max(
        est.markets.p1h,
        est.markets.p2h,
        est.markets.pTie
      ),
    };
    const ladder = hshPredictionToLadderResult(aligned);
    return {
      ...ladder,
      p_2h_gt_1h: est.markets.p2h_gt_1h,
      p_2h_eq_1h: est.markets.pTie,
      p_2h_lt_1h: est.markets.p1h,
      estimate: est,
    };
  });
  return [...rows].sort(compareCanonicalLadderDesc);
}

/** Sync helper when HSH ctx already built — markets.p2h_gt_1h identity with HSH. */
export function marketProbFromEstimate(
  est: CanonicalFixtureEstimate,
  market:
    | "hsh_2h_gt_1h"
    | "over25"
    | "under25"
    | "bttsYes"
    | "home"
    | "draw"
    | "away"
): number {
  switch (market) {
    case "hsh_2h_gt_1h":
      return est.markets.p2h_gt_1h;
    case "over25":
      return est.markets.over25;
    case "under25":
      return est.markets.under25;
    case "bttsYes":
      return est.markets.bttsYes;
    case "home":
      return est.markets.home;
    case "draw":
      return est.markets.draw;
    case "away":
      return est.markets.away;
  }
}

/**
 * Display probability (0–100) for recommendation / DM from CFE markets.
 * Returns null when the market is not covered or DIEH is insufficient.
 * Never blends probabilities — reads a single CFE slice.
 */
export function cfeDisplayProbPct(
  est: CanonicalFixtureEstimate,
  marketKey: string,
  prediction: string,
  line?: number
): number | null {
  const key = marketKey.toLowerCase();
  const pred = prediction.toLowerCase();

  if (key === "total_goals_ou") {
    const L = (line ?? 2.5) as keyof typeof est.markets.totalGoals.lines;
    const m = est.markets.totalGoals.lines[L] ?? {
      over: est.markets.over25,
      under: est.markets.under25,
    };
    const over = /\bover\b/.test(pred);
    return (over ? m.over : m.under) * 100;
  }

  if (key === "draw_one_half" || key === "draw_either_half") {
    const d = est.markets.dieh;
    if (d.status !== "ok" || d.diehYes == null || d.diehNo == null) return null;
    const yes = /\byes\b/.test(pred);
    return (yes ? d.diehYes : d.diehNo) * 100;
  }

  return null;
}

/** Re-export type for diagnostic panel. */
export type { CanonicalProbabilityResult };
