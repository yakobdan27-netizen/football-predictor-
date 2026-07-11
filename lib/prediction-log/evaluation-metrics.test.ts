import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ABSOLUTE_STAKE_CAP_PCT,
  MIN_BETS_FOR_MEANINGFUL_METRICS,
} from "./recommendation-config";
import {
  clvPct,
  collectSettledBets,
  computeEvaluationMetrics,
  evaluationRowsToCsv,
  mulberry32,
  runRealityCheckMonteCarlo,
} from "./evaluation-metrics";
import type { LogMatch, PredictionBatch } from "./types";

function settledMatch(
  id: string,
  opts: {
    stake: number;
    odds: number;
    wrong?: boolean;
    closingOdds?: number;
    confidence?: number;
  }
): LogMatch {
  return {
    id,
    homeTeam: "A",
    awayTeam: "B",
    predictions: {
      "1x2": {
        prediction: "home",
        confidence: opts.confidence ?? 55,
        odds: opts.odds,
      },
    },
    actualResults: {},
    scored: { "1x2": opts.wrong ? "wrong" : "correct" },
    stake: opts.stake,
    closingOdds: opts.closingOdds,
    primaryGrade: {
      result: opts.wrong ? "wrong" : "correct",
      reason: "",
    },
  };
}

function batch(date: string, matches: LogMatch[]): PredictionBatch {
  return {
    id: `b-${date}`,
    date,
    league: "Premier League",
    batchName: date,
    createdAt: `${date}T12:00:00.000Z`,
    matches,
  };
}

test("clvPct positive when taken odds beat closing", () => {
  const v = clvPct(2.1, 2.0);
  assert.ok(v != null && v > 0);
});

test("clvPct negative when taken odds worse than closing", () => {
  const v = clvPct(1.9, 2.0);
  assert.ok(v != null && v < 0);
});

test("computeEvaluationMetrics yield and win rate", () => {
  const metrics = computeEvaluationMetrics([
    batch("2025-01-01", [
      settledMatch("1", { stake: 10, odds: 2.0 }),
      settledMatch("2", { stake: 10, odds: 2.0, wrong: true }),
    ]),
  ]);
  assert.equal(metrics.n, 2);
  assert.equal(metrics.totalPnL, 0);
  assert.equal(metrics.yieldPct, 0);
  assert.equal(metrics.winRate, 50);
  assert.equal(metrics.metricsMeaningful, false);
  assert.ok(metrics.n < MIN_BETS_FOR_MEANINGFUL_METRICS);
});

test("rolling yield and CLV aggregate", () => {
  const matches = Array.from({ length: 60 }, (_, i) =>
    settledMatch(String(i), {
      stake: 10,
      odds: 2.0,
      wrong: i % 2 === 1,
      closingOdds: i % 3 === 0 ? 1.95 : undefined,
    })
  );
  const metrics = computeEvaluationMetrics([batch("2025-02-01", matches)]);
  assert.equal(metrics.n, 60);
  assert.ok(metrics.rollingYield50 != null);
  assert.ok(metrics.clvSample > 0);
  assert.ok(metrics.meanClvPct != null);
  assert.equal(metrics.cumulativePnL.length, 60);
});

test("max drawdown and losing streak", () => {
  const metrics = computeEvaluationMetrics([
    batch("2025-03-01", [
      settledMatch("a", { stake: 10, odds: 2.0, wrong: true }),
      settledMatch("b", { stake: 10, odds: 2.0, wrong: true }),
      settledMatch("c", { stake: 10, odds: 2.0, wrong: true }),
      settledMatch("d", { stake: 10, odds: 2.0 }),
    ]),
  ]);
  assert.equal(metrics.longestLosingStreak, 3);
  assert.ok(metrics.maxDrawdown >= 30);
});

test("Monte Carlo smoke is deterministic with seed", () => {
  const a = runRealityCheckMonteCarlo({
    winRatePct: 50,
    avgOdds: 2.0,
    stakePct: 1,
    simulations: 200,
    betsPerSim: 100,
    seed: 7,
  });
  const b = runRealityCheckMonteCarlo({
    winRatePct: 50,
    avgOdds: 2.0,
    stakePct: 1,
    simulations: 200,
    betsPerSim: 100,
    seed: 7,
  });
  assert.equal(a.pRuin50, b.pRuin50);
  assert.equal(a.medianFinalBankrollPct, b.medianFinalBankrollPct);
  assert.ok(a.pRuin50 >= 0 && a.pRuin50 <= 100);
});

test("mulberry32 returns values in unit interval", () => {
  const r = mulberry32(1);
  for (let i = 0; i < 20; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1);
  }
});

test("absolute stake cap constant is 2%", () => {
  assert.equal(ABSOLUTE_STAKE_CAP_PCT, 2);
});

test("CSV export includes CLV column", () => {
  const rows = collectSettledBets([
    batch("2025-04-01", [
      settledMatch("1", { stake: 10, odds: 2.1, closingOdds: 2.0 }),
    ]),
  ]);
  const csv = evaluationRowsToCsv(rows);
  assert.ok(csv.includes("clvPct"));
  assert.ok(csv.includes("2.1"));
});
