import assert from "node:assert/strict";
import { test } from "node:test";
import { settlementRowFromMatch } from "./persist-rich-settlement";
import type { LogMatch, PredictionBatch } from "./types";

function richMatch(id: string): LogMatch {
  return {
    id,
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    predictions: {},
    actualResults: {},
    scored: {},
    teamStats: {
      home: { goals: 3, firstHalfGoals: 1, corners: 5 },
      away: { goals: 1, firstHalfGoals: 1, corners: 3 },
      goalTiming: {
        timingBuckets: {
          g0_15: 1,
          g16_30: 0,
          g31_45: 1,
          g46_60: 0,
          g61_75: 1,
          g76_90plus: 1,
        },
      },
    },
  };
}

const batch: PredictionBatch = {
  id: "b-rich",
  batchName: "Rich",
  date: "2026-03-01",
  league: "Premier League",
  createdAt: "2026-03-01T10:00:00Z",
  matches: [richMatch("m1")],
};

test("settlementRowFromMatch builds Postgres payload shape", () => {
  const row = settlementRowFromMatch(batch, batch.matches[0]!, {
    coreFixtureId: 42,
    providerFixtureId: 999,
  });
  assert.ok(row);
  assert.equal(row!.batchId, "b-rich");
  assert.equal(row!.matchId, "m1");
  assert.equal(row!.ftHome, 3);
  assert.equal(row!.ftAway, 1);
  assert.equal(row!.htHome, 1);
  assert.equal(row!.htAway, 1);
  assert.equal(row!.matchHtTotal, 2);
  assert.equal(row!.match2hTotal, 2);
  assert.equal(row!.cornersHome, 5);
  assert.equal(row!.cornersAway, 3);
  assert.equal(row!.coreFixtureId, 42);
  assert.equal(row!.providerFixtureId, 999);
  assert.equal(row!.source, "prediction_log_batch");
  assert.ok(row!.goalTimingJson?.includes("g0_15"));
});

test("settlementRowFromMatch returns null when rich gate fails", () => {
  assert.equal(
    settlementRowFromMatch(batch, {
      ...richMatch("m2"),
      teamStats: { home: { goals: 1 }, away: { goals: 0 } },
    }),
    null
  );
});
