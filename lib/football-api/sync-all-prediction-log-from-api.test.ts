import assert from "node:assert/strict";
import { test } from "node:test";
import { batchNeedsAnyApiSync } from "./sync-all-prediction-log-from-api";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";

function batch(matches: LogMatch[]): PredictionBatch {
  return {
    id: "b1",
    date: "2026-01-01",
    league: "Premier League",
    batchName: "Test",
    createdAt: "2026-01-01T00:00:00Z",
    batchKind: "manual",
    source: "web",
    matches,
  };
}

test("batchNeedsAnyApiSync true when trace pending", () => {
  const b = batch([
    {
      id: "m1",
      homeTeam: "A",
      awayTeam: "B",
      predictions: { "1x2": { prediction: "home", confidence: 70 } },
      actualResults: {},
      scored: {},
      resultTraceState: "PENDING",
      resultFilled: false,
    },
  ]);
  assert.equal(batchNeedsAnyApiSync(b), true);
});

test("batchNeedsAnyApiSync true when FILLED but missing corners", () => {
  const b = batch([
    {
      id: "m1",
      homeTeam: "A",
      awayTeam: "B",
      predictions: {},
      actualResults: {},
      scored: {},
      resultFilled: true,
      resultTraceState: "FILLED",
      teamStats: { home: { goals: 2 }, away: { goals: 1 } },
    },
  ]);
  assert.equal(batchNeedsAnyApiSync(b), true);
});

test("batchNeedsAnyApiSync false when fully enriched", () => {
  const b = batch([
    {
      id: "m1",
      homeTeam: "A",
      awayTeam: "B",
      predictions: { "1x2": { prediction: "home", confidence: 70 } },
      actualResults: { "1x2": { actual: "home" } },
      scored: { "1x2": "correct" },
      resultFilled: true,
      resultTraceState: "FILLED",
      teamStats: {
        home: { goals: 2, corners: 4 },
        away: { goals: 1, corners: 3 },
        firstGoalSide: "home",
        goalTiming: {
          goalInFirst10: false,
          timingBuckets: {
            g0_15: 0,
            g16_30: 1,
            g31_45: 0,
            g46_60: 0,
            g61_75: 0,
            g76_90plus: 0,
          },
        },
        lineups: {
          home: { starting: ["P1"], substitutes: [] },
          away: { starting: ["P2"], substitutes: [] },
        },
      },
    },
  ]);
  assert.equal(batchNeedsAnyApiSync(b), false);
});
