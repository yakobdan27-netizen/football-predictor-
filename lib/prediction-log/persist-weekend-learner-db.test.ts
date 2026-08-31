import assert from "node:assert/strict";
import { test } from "node:test";
import type { PredictionBatch } from "./types";
import {
  extractWeekendPickOutcome,
  weekendSurfaceFromBatchId,
} from "./persist-weekend-learner-db";

test("weekendSurfaceFromBatchId maps batch suffixes", () => {
  assert.equal(weekendSurfaceFromBatchId("WEEKEND-2026-08-30"), "POOL");
  assert.equal(weekendSurfaceFromBatchId("WEEKEND-CORNERS-2026-08-30"), "CORNERS");
  assert.equal(weekendSurfaceFromBatchId("WEEKEND-PORTFOLIO-2026-08-30"), "PORTFOLIO");
});

test("extractWeekendPickOutcome returns graded row for finished corners pick", () => {
  const batch: PredictionBatch = {
    id: "WEEKEND-CORNERS-2026-08-30",
    date: "2026-08-30",
    league: "Premier League",
    batchName: "Weekend Corners",
    createdAt: new Date().toISOString(),
    batchKind: "manual",
    matches: [
      {
        id: "m1",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        league: "Premier League",
        matchDate: "2026-08-30",
        apiFixtureId: 101,
        predictions: { corners_ou: { prediction: "over", line: 9.5, confidence: 58 } },
        actualResults: { corners_ou: { actual: 8 } },
        scored: { corners_ou: "wrong" },
        teamStats: {
          home: { goals: 2, firstHalfGoals: 1, corners: 4 },
          away: { goals: 1, firstHalfGoals: 0, corners: 4 },
        },
        resultFilled: true,
      },
    ],
  };

  const row = extractWeekendPickOutcome(batch, batch.matches[0]!);
  assert.ok(row);
  assert.equal(row!.weekendSurface, "CORNERS");
  assert.equal(row!.marketKey, "corners_ou");
  assert.equal(row!.prediction, "over");
  assert.equal(row!.result, "wrong");
  assert.equal(row!.ftHome, 2);
  assert.equal(row!.cornersHome, 4);
});

test("extractWeekendPickOutcome skips base pool batch", () => {
  const batch: PredictionBatch = {
    id: "WEEKEND-2026-08-30",
    date: "2026-08-30",
    league: "Mixed",
    batchName: "Pool",
    createdAt: new Date().toISOString(),
    batchKind: "manual",
    matches: [
      {
        id: "m1",
        homeTeam: "A",
        awayTeam: "B",
        league: "Premier League",
        predictions: {},
        actualResults: {},
        scored: {},
        teamStats: { home: { goals: 1 }, away: { goals: 0 } },
      },
    ],
  };
  assert.equal(extractWeekendPickOutcome(batch, batch.matches[0]!), null);
});
