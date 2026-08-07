import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bttsYesNo,
  computeGoalDistribution,
  overUnderFromLambda,
  overUnderFromTotalPmf,
  eventProbPctFromScoreGrid,
} from "./goal-distribution";

const LINES = [0.5, 1.5, 2.5, 3.5, 4.5] as const;

test("goal distribution PMFs normalize to 1", () => {
  const dist = computeGoalDistribution(1.4, 1.1);
  const sumTotal = dist.totalPmf.reduce((a, b) => a + b, 0);
  const sumHome = dist.homePmf.reduce((a, b) => a + b, 0);
  const sumAway = dist.awayPmf.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sumTotal - 1) < 1e-9);
  assert.ok(Math.abs(sumHome - 1) < 1e-9);
  assert.ok(Math.abs(sumAway - 1) < 1e-9);
});

test("total goals Over + Under = 1 for every line", () => {
  const dist = computeGoalDistribution(1.6, 1.2);
  for (const line of LINES) {
    const [over, under] = overUnderFromTotalPmf(dist.totalPmf, line);
    assert.ok(
      Math.abs(over + under - 1) < 1e-9,
      `line ${line}: ${over}+${under}`
    );
  }
});

test("BTTS Yes + No = 1", () => {
  const dist = computeGoalDistribution(1.5, 1.3);
  const [yes, no] = bttsYesNo(dist.matrix);
  assert.ok(Math.abs(yes + no - 1) < 1e-9);
});

test("univariate corner/HT Over + Under = 1", () => {
  for (const lambda of [0.6, 3.8, 5.5, 7.2]) {
    for (const line of [0.5, 1.5, 3.5, 4.5, 5.5, 6.5]) {
      const [over, under] = overUnderFromLambda(lambda, line);
      assert.ok(Math.abs(over + under - 1) < 1e-9);
    }
  }
});

test("eventProbPctFromScoreGrid sides are complementary", () => {
  const dist = computeGoalDistribution(1.8, 1.0);
  const overPct = eventProbPctFromScoreGrid(
    "total_goals_ou",
    "Over 2.5",
    2.5,
    dist.matrix
  );
  const underPct = eventProbPctFromScoreGrid(
    "total_goals_ou",
    "Under 2.5",
    2.5,
    dist.matrix
  );
  assert.ok(overPct != null && underPct != null);
  assert.ok(Math.abs(overPct + underPct - 100) < 1e-6);
});
