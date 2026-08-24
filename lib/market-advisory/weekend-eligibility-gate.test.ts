/**
 * Run: npx tsx lib/market-advisory/weekend-eligibility-gate.test.ts
 */
import assert from "node:assert/strict";
import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import {
  weekendMsamEligible,
  weekendMsamIneligibilityReasons,
} from "./weekend-eligibility-gate";

function mockCfe(
  overrides?: Partial<CanonicalFixtureEstimate>
): CanonicalFixtureEstimate {
  const base: CanonicalFixtureEstimate = {
    lambdas: {
      home: 1.5,
      away: 1.1,
      home_1h: 0.7,
      away_1h: 0.5,
      home_2h: 0.8,
      away_2h: 0.6,
      home_corners: 5,
      away_corners: 4.5,
      home_sot: 2.5,
      away_sot: 2.1,
    },
    score_matrix: [[0.2, 0.15], [0.12, 0.1]],
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
          match: {
            3.5: { over: 0.6, under: 0.4 },
            4.5: { over: 0.58, under: 0.42 },
            5.5: { over: 0.4, under: 0.6 },
          },
          home: {
            1.5: { over: 0.6, under: 0.4 },
            2.5: { over: 0.55, under: 0.45 },
            3.5: { over: 0.35, under: 0.65 },
          },
          away: {
            1.5: { over: 0.55, under: 0.45 },
            2.5: { over: 0.48, under: 0.52 },
            3.5: { over: 0.3, under: 0.7 },
          },
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
    diagnostics: {
      lambda1hPlus2h: 2.6,
      lambdaFt: 2.6,
      halfSumOk: true,
    },
  };
  return { ...base, ...overrides };
}

assert.ok(
  weekendMsamEligible({
    family: "RESULT_1X2",
    pRaw: 0.5,
    nEffective: 10,
    coherenceOk: true,
    cfe: mockCfe(),
  })
);

const lowSample = weekendMsamIneligibilityReasons({
  family: "RESULT_1X2",
  pRaw: 0.5,
  nEffective: 3,
  coherenceOk: true,
  cfe: mockCfe(),
});
assert.ok(lowSample.includes("INSUFFICIENT_SAMPLE"));

const noHt = weekendMsamIneligibilityReasons({
  family: "DIEH",
  pRaw: 0.6,
  nEffective: 10,
  coherenceOk: true,
  cfe: mockCfe({
    coverage: { ht_pct: 10, corners_pct: 70 },
    diagnostics: { lambda1hPlus2h: 2.6, lambdaFt: 2.6, halfSumOk: false },
  }),
});
assert.ok(noHt.includes("INSUFFICIENT_HT_HISTORY"));

const noCorners = weekendMsamIneligibilityReasons({
  family: "CORNERS",
  pRaw: 0.55,
  nEffective: 10,
  coherenceOk: true,
  cfe: mockCfe({
    coverage: { ht_pct: 80, corners_pct: 10 },
    lambdas: {
      ...mockCfe().lambdas,
      home_corners: 0.1,
      away_corners: 0.1,
    },
    provenance: { ...mockCfe().provenance, ess: 2 },
  }),
});
assert.ok(noCorners.includes("CORNERS_MODEL_UNAVAILABLE"));

console.log("weekend-eligibility-gate tests passed");
