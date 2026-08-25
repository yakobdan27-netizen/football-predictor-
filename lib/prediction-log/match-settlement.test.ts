import assert from "node:assert/strict";
import { test } from "node:test";
import {
  batchAllMatchesRichSettlement,
  matchHalfTotals,
  matchHasRichSettlement,
  richSettlementFingerprint,
  timingBucketsComplete,
  timingGoalsSum,
} from "./match-settlement";
import type { LogMatch, PredictionBatch } from "./types";

function richMatch(id: string, overrides: Partial<LogMatch> = {}): LogMatch {
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
    ...overrides,
  };
}

function batch(matches: LogMatch[], date = "2026-03-01"): PredictionBatch {
  return {
    id: "b1",
    batchName: "Test",
    date,
    league: "Premier League",
    createdAt: "2026-03-01T10:00:00Z",
    matches,
  };
}

test("matchHalfTotals derives HT and 2H match totals", () => {
  assert.deepEqual(matchHalfTotals(richMatch("m1")), { htTotal: 2, h2Total: 2 });
  assert.deepEqual(matchHalfTotals(richMatch("m1", { teamStats: { home: { goals: 2 }, away: {} } })), {
    htTotal: null,
    h2Total: null,
  });
});

test("timingGoalsSum requires all six buckets", () => {
  assert.equal(timingGoalsSum(richMatch("m1").teamStats?.goalTiming), 4);
  const incompleteBuckets = { ...richMatch("m1").teamStats!.goalTiming!.timingBuckets! };
  delete (incompleteBuckets as { g76_90plus?: number }).g76_90plus;
  assert.equal(
    timingGoalsSum({ timingBuckets: incompleteBuckets }),
    null
  );
  assert.equal(timingBucketsComplete(richMatch("m1").teamStats?.goalTiming), true);
});

test("matchHasRichSettlement requires FT HT corners and timing sum = FT total", () => {
  assert.equal(matchHasRichSettlement(richMatch("m1")), true);
  assert.equal(
    matchHasRichSettlement(
      richMatch("m1", {
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
              g76_90plus: 0,
            },
          },
        },
      })
    ),
    false
  );
  assert.equal(
    matchHasRichSettlement(richMatch("m1", { teamStats: { home: { goals: 2 }, away: { goals: 1 } } })),
    false
  );
});

test("batchAllMatchesRichSettlement is true only when every match passes", () => {
  assert.equal(batchAllMatchesRichSettlement(batch([richMatch("m1"), richMatch("m2")])), true);
  assert.equal(
    batchAllMatchesRichSettlement(batch([richMatch("m1"), richMatch("m2", { teamStats: { home: { goals: 1 }, away: { goals: 0 } } })])),
    false
  );
});

test("richSettlementFingerprint changes when rich stats change", () => {
  const b = batch([richMatch("m1")]);
  const fp1 = richSettlementFingerprint(b);
  const fp2 = richSettlementFingerprint(
    batch([
      richMatch("m1", {
        teamStats: {
          ...richMatch("m1").teamStats!,
          home: { goals: 4, firstHalfGoals: 2, corners: 5 },
        },
      }),
    ])
  );
  assert.notEqual(fp1, fp2);
});
