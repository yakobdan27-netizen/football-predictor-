import assert from "node:assert/strict";
import test from "node:test";
import {
  TOTAL_GOALS_LINES,
  buildTotalGoalsMarkets,
  expectedFromPmf,
  bucketExactTotals,
} from "./total-goals-markets";
import { computeGoalDistribution } from "./goal-distribution";
import { totalGoalsPmf } from "@/lib/predictor/score-matrix";

test("total goals PMF sums to 1", () => {
  const m = buildTotalGoalsMarkets({
    lambdaHome: 1.5,
    lambdaAway: 1.2,
    rho: -0.13,
  });
  const sum = m.pmf.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test("every O/U line complements to 1", () => {
  const m = buildTotalGoalsMarkets({
    lambdaHome: 1.6,
    lambdaAway: 1.0,
    rho: -0.1,
  });
  for (const line of TOTAL_GOALS_LINES) {
    const { over, under } = m.lines[line];
    assert.ok(Math.abs(over + under - 1) < 1e-9, `line ${line}`);
  }
});

test("Over probabilities are monotone decreasing in line", () => {
  const m = buildTotalGoalsMarkets({
    lambdaHome: 1.4,
    lambdaAway: 1.3,
    rho: -0.12,
  });
  for (let i = 1; i < TOTAL_GOALS_LINES.length; i++) {
    const prev = m.lines[TOTAL_GOALS_LINES[i - 1]!]!.over;
    const cur = m.lines[TOTAL_GOALS_LINES[i]!]!.over;
    assert.ok(cur <= prev + 1e-9);
  }
});

test("analytic E[T] equals λh+λa; PMF mean tracks within truncation band", () => {
  const lh = 1.55;
  const la = 1.25;
  const markets = buildTotalGoalsMarkets({
    lambdaHome: lh,
    lambdaAway: la,
    rho: -0.13,
    maxGoals: 9,
  });
  assert.ok(Math.abs(markets.expectedTotal - (lh + la)) < 1e-9);

  const dist = computeGoalDistribution(lh, la, { rho: -0.13, maxGoals: 9 });
  const fine = totalGoalsPmf(dist.matrix);
  let eFine = 0;
  for (let k = 0; k < fine.length; k++) eFine += k * (fine[k] ?? 0);
  // Renormalised truncated DC matrix: mean is slightly below λh+λa.
  assert.ok(Math.abs(eFine - (lh + la)) < 0.05);

  const bucketed = bucketExactTotals(fine);
  const eB = expectedFromPmf(bucketed);
  assert.ok(Math.abs(eB - (lh + la)) < 0.35);
});

test("NegBin path when overdispersed", () => {
  const m = buildTotalGoalsMarkets({
    lambdaHome: 1.5,
    lambdaAway: 1.2,
    rho: -0.13,
    distributionFamily: "negbin",
    dispersion: 1.35,
  });
  assert.equal(m.distributionFamily, "negbin");
  assert.ok(Math.abs(m.pmf.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(Math.abs(m.lines[2.5].over + m.lines[2.5].under - 1) < 1e-9);
});
