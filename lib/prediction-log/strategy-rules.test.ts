import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ABSOLUTE_STAKE_CAP_PCT,
  defaultBankrollStrategySettings,
} from "./recommendation-config";
import {
  applyTierToSuggestedStake,
  batchPnL,
  evaluateBankrollHealth,
  evaluateStopLoss,
  matchPnL,
  maxRecommendedStake,
  suggestStake,
} from "./strategy-rules";
import type { LogMatch, PredictionBatch } from "./types";

function settings(
  patch: Partial<ReturnType<typeof defaultBankrollStrategySettings>> = {}
) {
  return { ...defaultBankrollStrategySettings(), bankroll: 1000, ...patch };
}

test("suggestStake flat uses flatStakePct and caps at maxRisk", () => {
  const r = suggestStake({
    settings: settings({ stakingMode: "flat", flatStakePct: 1, maxRiskPctPerBet: 2 }),
    pSignal: 60,
    odds: 2.0,
  });
  assert.equal(r.suggested, 10);
});

test("suggestStake flat respects maxRiskPctPerBet", () => {
  const r = suggestStake({
    settings: settings({
      stakingMode: "flat",
      flatStakePct: 5,
      maxRiskPctPerBet: 2,
    }),
    pSignal: 60,
    odds: 2.0,
  });
  assert.equal(r.suggested, 20);
});

test("suggestStake never exceeds absolute 2% cap", () => {
  const r = suggestStake({
    settings: settings({
      stakingMode: "flat",
      flatStakePct: 5,
      maxRiskPctPerBet: 2,
    }),
    pSignal: 90,
    odds: 1.5,
    tier: "aggressive",
  });
  assert.ok(r.suggested != null);
  assert.ok(r.suggested! <= (1000 * ABSOLUTE_STAKE_CAP_PCT) / 100);
});

test("suggestStake half-Kelly positive edge", () => {
  const r = suggestStake({
    settings: settings({ stakingMode: "half_kelly", maxRiskPctPerBet: 2 }),
    pSignal: 60,
    odds: 2.2,
  });
  assert.ok(r.suggested != null && r.suggested > 0);
  assert.ok(r.suggested! <= 20);
});

test("suggestStake quarter-Kelly is smaller than half-Kelly", () => {
  // Modest edge so neither hits the 2% hard cap.
  const half = suggestStake({
    settings: settings({ stakingMode: "half_kelly", maxRiskPctPerBet: 2 }),
    pSignal: 52,
    odds: 2.0,
  });
  const quarter = suggestStake({
    settings: settings({ stakingMode: "quarter_kelly", maxRiskPctPerBet: 2 }),
    pSignal: 52,
    odds: 2.0,
  });
  assert.ok(half.suggested != null && quarter.suggested != null);
  assert.ok(quarter.suggested! < half.suggested!);
});

test("suggestStake returns null without bankroll", () => {
  const r = suggestStake({
    settings: settings({ bankroll: null }),
    pSignal: 60,
    odds: 2.0,
  });
  assert.equal(r.suggested, null);
});

test("suggestStake applies tier multiplier then cap", () => {
  const r = suggestStake({
    settings: settings({
      stakingMode: "flat",
      flatStakePct: 1,
      maxRiskPctPerBet: 2,
      tierStakeMult: { safe: 0.75, balanced: 1, aggressive: 1.25 },
    }),
    pSignal: 55,
    odds: 2.0,
    tier: "aggressive",
  });
  assert.equal(r.suggested, 12.5);
});

test("maxRecommendedStake uses maxRiskPct", () => {
  assert.equal(maxRecommendedStake(settings({ maxRiskPctPerBet: 1 })), 10);
  assert.equal(maxRecommendedStake(settings({ maxRiskPctPerBet: 2 })), 20);
});

test("matchPnL hit and miss", () => {
  const hit: LogMatch = {
    id: "1",
    homeTeam: "A",
    awayTeam: "B",
    predictions: { "1x2": { prediction: "home", confidence: 60, odds: 2.0 } },
    actualResults: {},
    scored: { "1x2": "correct" },
    stake: 10,
    primaryGrade: { result: "correct", reason: "ok" },
  };
  assert.equal(matchPnL(hit), 10);
  const miss = {
    ...hit,
    scored: { "1x2": "wrong" as const },
    primaryGrade: { result: "wrong" as const, reason: "no" },
  };
  assert.equal(matchPnL(miss), -10);
});

test("batchPnL aggregates ROI", () => {
  const matches: LogMatch[] = [
    {
      id: "1",
      homeTeam: "A",
      awayTeam: "B",
      predictions: { "1x2": { prediction: "home", confidence: 60, odds: 2.0 } },
      actualResults: {},
      scored: { "1x2": "correct" },
      stake: 10,
      primaryGrade: { result: "correct", reason: "" },
    },
    {
      id: "2",
      homeTeam: "C",
      awayTeam: "D",
      predictions: { "1x2": { prediction: "home", confidence: 60, odds: 2.0 } },
      actualResults: {},
      scored: { "1x2": "wrong" },
      stake: 10,
      primaryGrade: { result: "wrong", reason: "" },
    },
  ];
  const agg = batchPnL(matches);
  assert.equal(agg.totalPnL, 0);
  assert.equal(agg.staked, 20);
  assert.equal(agg.roiPct, 0);
});

test("evaluateStopLoss consecutive losses", () => {
  const mk = (id: string, date: string, wrong: boolean): PredictionBatch => ({
    id,
    date,
    league: "Premier League",
    batchName: id,
    createdAt: `${date}T12:00:00.000Z`,
    matches: [
      {
        id: `${id}-m`,
        homeTeam: "A",
        awayTeam: "B",
        predictions: { "1x2": { prediction: "home", confidence: 55, odds: 2.0 } },
        actualResults: {},
        scored: { "1x2": wrong ? "wrong" : "correct" },
        stake: 10,
        primaryGrade: {
          result: wrong ? "wrong" : "correct",
          reason: "",
        },
      },
    ],
  });
  const status = evaluateStopLoss(
    [mk("a", "2025-01-01", true), mk("b", "2025-01-02", true), mk("c", "2025-01-03", true)],
    settings({ stopLossConsecutiveLosses: 3 }),
    "2025-01-03"
  );
  assert.equal(status.stopLossActive, true);
  assert.equal(status.consecutiveLosses, 3);
  assert.equal(status.suggestedAction, "pause");
});

test("evaluateStopLoss daily drawdown", () => {
  const batch: PredictionBatch = {
    id: "d",
    date: "2025-06-01",
    league: "Premier League",
    batchName: "d",
    createdAt: "2025-06-01T12:00:00.000Z",
    matches: [
      {
        id: "m1",
        homeTeam: "A",
        awayTeam: "B",
        predictions: { "1x2": { prediction: "home", confidence: 50, odds: 2.0 } },
        actualResults: {},
        scored: { "1x2": "wrong" },
        stake: 120,
        primaryGrade: { result: "wrong", reason: "" },
      },
    ],
  };
  const status = evaluateStopLoss(
    [batch],
    settings({ stopLossDailyDrawdownPct: 10, stopLossConsecutiveLosses: 99 }),
    "2025-06-01"
  );
  assert.equal(status.stopLossActive, true);
  assert.ok((status.todayDrawdownPct ?? 0) >= 10);
});

test("evaluateStopLoss rolling drawdown", () => {
  const mk = (id: string, date: string, stake: number): PredictionBatch => ({
    id,
    date,
    league: "Premier League",
    batchName: id,
    createdAt: `${date}T12:00:00.000Z`,
    matches: [
      {
        id: `${id}-m`,
        homeTeam: "A",
        awayTeam: "B",
        predictions: { "1x2": { prediction: "home", confidence: 50, odds: 2.0 } },
        actualResults: {},
        scored: { "1x2": "wrong" },
        stake,
        primaryGrade: { result: "wrong", reason: "" },
      },
    ],
  });
  const status = evaluateStopLoss(
    [mk("a", "2025-05-20", 150), mk("b", "2025-05-25", 150)],
    settings({
      stopLossConsecutiveLosses: 99,
      stopLossDailyDrawdownPct: 99,
      stopLossRollingDays: 30,
      stopLossRollingDrawdownPct: 25,
    }),
    "2025-06-01"
  );
  assert.equal(status.stopLossActive, true);
  assert.ok((status.rollingDrawdownPct ?? 0) >= 25);
});

test("evaluateBankrollHealth thresholds", () => {
  const h = evaluateBankrollHealth(
    settings({ bankroll: 500, startingBankroll: 1000, maxRiskPctPerBet: 1 })
  );
  assert.ok(h.thresholdsHit.includes(50));
  assert.ok(h.messages.length > 0);
  assert.equal(h.maxStake, 5);
});

test("applyTierToSuggestedStake", () => {
  assert.equal(
    applyTierToSuggestedStake(10, settings({ maxRiskPctPerBet: 2 }), "aggressive"),
    12.5
  );
});
