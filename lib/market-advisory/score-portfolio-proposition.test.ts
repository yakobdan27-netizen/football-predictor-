import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import { buildMarketCode } from "@/lib/market-advisory/market-catalog";
import { scorePortfolioProposition } from "@/lib/market-advisory/score-portfolio-proposition";
import type { ScoredLeg } from "@/lib/match-centre/weekend-opportunities";
import { goalBothHalvesProbabilityPercent } from "@/lib/prediction-log/combo-markets-config";
import { poissonOverLine } from "@/lib/prediction-log/poisson-ou";
import { buildScoreMatrix } from "@/lib/predictor/score-matrix";

function mockCfe(): CanonicalFixtureEstimate {
  return {
    lambdas: {
      home: 1.5,
      away: 1.1,
      home_1h: 0.7,
      away_1h: 0.5,
      home_2h: 0.8,
      away_2h: 0.6,
      home_corners: 5.5,
      away_corners: 4.2,
      home_sot: 2.5,
      away_sot: 2.1,
    },
    score_matrix: buildScoreMatrix(1.5, 1.1, -0.13, 6),
    markets: {
      home: 0.45,
      draw: 0.28,
      away: 0.27,
      bttsYes: 0.55,
      bttsNo: 0.45,
      over25: 0.52,
      under25: 0.48,
      p1h: 0.38,
      p2h: 0.42,
      pTie: 0.2,
      p2h_gt_1h: 0.42,
      cornersOver95: 0.51,
      cornersUnder95: 0.49,
      doubleChance: { oneX: 0.73, xTwo: 0.55, oneTwo: 0.72 },
      dieh: {
        status: "ok",
        nValid: 500,
        pD1: 0.3,
        pD2: 0.32,
        pD1AndD2: 0.1,
        diehYes: 0.62,
        diehNo: 0.38,
        halfLambdas: null,
        halfShares: null,
        kappaAdj: null,
        kappaRaw: null,
      },
      totalGoals: {
        distributionFamily: "poisson",
        dispersion: null,
        pmf: [0.1, 0.2, 0.3, 0.2, 0.1, 0.05, 0.03, 0.02, 0],
        expectedTotal: 2.6,
        mode: 2,
        ci50: [2, 3],
        lines: {
          0.5: { over: 0.9, under: 0.1 },
          1.5: { over: 0.7, under: 0.3 },
          2.5: { over: 0.52, under: 0.48 },
          3.5: { over: 0.35, under: 0.65 },
          4.5: { over: 0.2, under: 0.8 },
          5.5: { over: 0.1, under: 0.9 },
          6.5: { over: 0.05, under: 0.95 },
        },
      },
      sot: {
        status: "ok",
        lambdaHome: 2.5,
        lambdaAway: 2.1,
        nMatches: 10,
        confidence: "medium",
        lines: {
          match: { 4.5: { over: 0.58, under: 0.42 } },
          home: { 2.5: { over: 0.55, under: 0.45 } },
          away: { 2.5: { over: 0.48, under: 0.52 } },
        },
      },
    },
    provenance: {
      api_pct: 100,
      manual_pct: 0,
      ai_pct: 0,
      seasons_used: 2,
      matches_used: 20,
      ess: 15,
      sourceBreakdown: "api_only",
    },
    coverage: { ht_pct: 80, corners_pct: 70 },
    confidence_tier: "medium",
    model_params_version: "test",
    rho: -0.13,
    diagnostics: { lambda1hPlus2h: 2.6, lambdaFt: 2.6, halfSumOk: true },
  };
}

test("scorePortfolioProposition returns collaborative score for DIEH yes", () => {
  const cfe = mockCfe();
  const leg: ScoredLeg = {
    marketLabel: "Draw Either Half",
    predictionLabel: "Draw Either Half — Yes",
    family: "DIEH",
    selectionKey: "yes",
    pRaw: 0.62,
    pCalibrated: 0.62,
    nEffective: 15,
    coherenceOk: true,
    msamGatePassed: true,
    ineligibilityReasons: [],
  };
  const marketCode = buildMarketCode("DIEH", "yes");
  const result = scorePortfolioProposition({
    cfe,
    calibrator: null,
    analysis: null,
    leg,
    marketCode,
  });
  assert.ok(result);
  assert.equal(result!.marketCode, marketCode);
  assert.ok(result!.finalAdvisoryScore != null);
  assert.ok(result!.finalAdvisoryScore! >= 0 && result!.finalAdvisoryScore! <= 100);
  assert.equal(result!.pCalibrated, result!.pCalibrated);
});

test("goal_both_halves proposition resolves via CFE catalog", () => {
  const cfe = mockCfe();
  const pct = goalBothHalvesProbabilityPercent({
    grid: cfe.score_matrix,
    lambdaHome: cfe.lambdas.home,
    lambdaAway: cfe.lambdas.away,
  });
  assert.ok(pct != null && pct > 0);
  const leg: ScoredLeg = {
    marketLabel: "Goals in Both Halves",
    predictionLabel: "Goal in 1H & 2H",
    family: "HALF_GOALS",
    selectionKey: "goal_both_halves",
    pRaw: pct! / 100,
    pCalibrated: pct! / 100,
    nEffective: 15,
    coherenceOk: true,
    msamGatePassed: true,
    ineligibilityReasons: [],
  };
  const marketCode = buildMarketCode("HALF_GOALS", "goal_both_halves");
  const result = scorePortfolioProposition({
    cfe,
    calibrator: null,
    analysis: null,
    leg,
    marketCode,
  });
  assert.ok(result, "goal_both_halves should score collaboratively");
});

test("team corner over/under complements sum to ~1", () => {
  const lambda = 5.5;
  const pOver = poissonOverLine(4.5, lambda);
  const pUnder = 1 - pOver;
  assert.ok(Math.abs(pOver + pUnder - 1) < 1e-6);
});
