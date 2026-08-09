import assert from "node:assert/strict";
import test from "node:test";
import {
  computeDiehMarkets,
  computeHalfLambdas,
  halfLevelProbability,
} from "./dieh-probability";
import type { LeagueHalfParams } from "@/lib/hist/half-params-types";
import {
  DIEH_MIN_VALID_FIXTURES,
  KAPPA_SHRINKAGE_M,
} from "@/lib/hist/half-params-types";

function sampleParams(overrides?: Partial<LeagueHalfParams>): LeagueHalfParams {
  return {
    leagueId: 39,
    compType: "league",
    leagueName: "Premier League",
    s1: 0.44,
    s1Home: 0.43,
    s1Away: 0.45,
    usedCombinedShareHome: false,
    usedCombinedShareAway: false,
    nValid: 500,
    nHomeGoalsSample: 500,
    nAwayGoalsSample: 500,
    kappaRaw: 1.05,
    kappaAdj: (500 * 1.05 + KAPPA_SHRINKAGE_M) / (500 + KAPPA_SHRINKAGE_M),
    pD1Obs: 0.3,
    pD2Obs: 0.28,
    pD1d2Obs: 0.09,
    goalsMean: 2.7,
    goalsVariance: 2.9,
    goalsDispersion: 2.9 / 2.7,
    goalsDistribution: "poisson",
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("half λ invariant: h1+h2 = FT λ", () => {
  const hl = computeHalfLambdas(1.5, 1.2, sampleParams());
  assert.ok(Math.abs(hl.home1 + hl.home2 - 1.5) < 1e-9);
  assert.ok(Math.abs(hl.away1 + hl.away2 - 1.2) < 1e-9);
});

test("halfLevelProbability truncates with small tail", () => {
  const { p, tailMass } = halfLevelProbability(0.7, 0.6);
  assert.ok(p > 0 && p < 1);
  assert.ok(tailMass < 1e-10);
});

test("DIEH complement and inclusion-exclusion bounds", () => {
  const m = computeDiehMarkets({
    lambdaHome: 1.45,
    lambdaAway: 1.15,
    halfParams: sampleParams(),
  });
  assert.equal(m.status, "ok");
  assert.ok(m.diehYes != null && m.diehNo != null);
  assert.ok(Math.abs(m.diehYes! + m.diehNo! - 1) < 1e-9);
  assert.ok(m.pD1AndD2! <= Math.min(m.pD1!, m.pD2!) + 1e-9);
  assert.ok(m.diehYes! + 1e-9 >= Math.max(m.pD1!, m.pD2!));
  assert.ok(m.diehYes! <= m.pD1! + m.pD2! + 1e-9);
});

test("insufficient data when n_valid below threshold", () => {
  const m = computeDiehMarkets({
    lambdaHome: 1.4,
    lambdaAway: 1.1,
    halfParams: sampleParams({ nValid: DIEH_MIN_VALID_FIXTURES - 1 }),
  });
  assert.equal(m.status, "insufficient");
  assert.equal(m.diehYes, null);
  assert.ok(m.message?.includes("INSUFFICIENT"));
});

test("null half params → insufficient", () => {
  const m = computeDiehMarkets({
    lambdaHome: 1.4,
    lambdaAway: 1.1,
    halfParams: null,
  });
  assert.equal(m.status, "insufficient");
});
