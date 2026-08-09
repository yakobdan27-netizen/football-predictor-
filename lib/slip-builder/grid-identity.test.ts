import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildScoreMatrix, outcomeProbsFromMatrix } from "@/lib/predictor/score-matrix";
import { resolveCfeLegProbability } from "@/lib/prediction-log/cfe-leg-probability";
import type { CfeLegEstimateSlice } from "@/lib/prediction-log/cfe-leg-probability";
import { buildTotalGoalsMarkets } from "@/lib/prediction-log/total-goals-markets";

function makeSlice(lambdaH = 1.6, lambdaA = 1.1): CfeLegEstimateSlice {
  const grid = buildScoreMatrix(lambdaH, lambdaA, -0.13, 8);
  const o = outcomeProbsFromMatrix(grid);
  const tg = buildTotalGoalsMarkets({
    lambdaHome: lambdaH,
    lambdaAway: lambdaA,
    rho: -0.13,
    distributionFamily: "poisson",
    dispersion: null,
  });
  return {
    lambdas: {
      home: lambdaH,
      away: lambdaA,
      home_1h: lambdaH * 0.45,
      away_1h: lambdaA * 0.45,
      home_2h: lambdaH * 0.55,
      away_2h: lambdaA * 0.55,
      home_corners: 5,
      away_corners: 4.5,
    },
    score_matrix: grid,
    markets: {
      home: o.home,
      draw: o.draw,
      away: o.away,
      bttsYes: 0.5,
      bttsNo: 0.5,
      over25: tg.lines[2.5].over,
      under25: tg.lines[2.5].under,
      p1h: 0.3,
      p2h: 0.45,
      pTie: 0.25,
      p2h_gt_1h: 0.45,
      cornersOver95: 0.55,
      cornersUnder95: 0.45,
      doubleChance: {
        oneX: o.home + o.draw,
        xTwo: o.away + o.draw,
        oneTwo: o.home + o.away,
      },
      dieh: { status: "ok", diehYes: 0.62, diehNo: 0.38 },
      totalGoals: { lines: tg.lines },
    },
    provenance: { ess: 120, matches_used: 120 },
    rho: -0.13,
  };
}

describe("grid identity (tests 11–12)", () => {
  it("P(Home)+P(Draw)+P(Away) sums to 1", () => {
    const est = makeSlice();
    const h = resolveCfeLegProbability({
      estimate: est,
      family: "RESULT_1X2",
      selectionKey: "home",
    }).prob;
    const d = resolveCfeLegProbability({
      estimate: est,
      family: "RESULT_1X2",
      selectionKey: "draw",
    }).prob;
    const a = resolveCfeLegProbability({
      estimate: est,
      family: "RESULT_1X2",
      selectionKey: "away",
    }).prob;
    assert.ok(Math.abs(h + d + a - 1) < 1e-9);
  });

  it("P(1X) = P(Home)+P(Draw) from same grid", () => {
    const est = makeSlice();
    const h = resolveCfeLegProbability({
      estimate: est,
      family: "RESULT_1X2",
      selectionKey: "home",
    }).prob;
    const d = resolveCfeLegProbability({
      estimate: est,
      family: "RESULT_1X2",
      selectionKey: "draw",
    }).prob;
    const oneX = resolveCfeLegProbability({
      estimate: est,
      family: "DOUBLE_CHANCE",
      selectionKey: "1X",
    }).prob;
    assert.ok(Math.abs(oneX - (h + d)) < 1e-9);
  });
});
