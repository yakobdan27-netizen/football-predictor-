import assert from "node:assert/strict";
import { test } from "node:test";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";
import {
  batchFillPriority,
  groupApiFillWorkByFixture,
  propagateFillData,
  type ApiFillWorkItem,
} from "./sync-batch-api-fill";

function stubBatch(id: string, matches: LogMatch[]): PredictionBatch {
  return {
    id,
    date: "2026-08-30",
    league: "Mixed",
    batchName: id,
    createdAt: new Date().toISOString(),
    batchKind: "manual",
    matches,
  };
}

function stubMatch(
  id: string,
  apiFixtureId: number,
  extra?: Partial<LogMatch>
): LogMatch {
  return {
    id,
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    league: "Premier League",
    apiFixtureId,
    predictions: { corners_ou: { prediction: "over", line: 9.5, confidence: 55 } },
    actualResults: {},
    scored: {},
    ...extra,
  };
}

test("batchFillPriority prefers base weekend pool batch", () => {
  assert.ok(batchFillPriority("WEEKEND-2026-08-30") < batchFillPriority("WEEKEND-CORNERS-2026-08-30"));
  assert.ok(batchFillPriority("WEEKEND-CORNERS-2026-08-30") < batchFillPriority("TELEGRAM-2026-08-30"));
});

test("groupApiFillWorkByFixture dedupes same apiFixtureId across batches", () => {
  const fixtureId = 101;
  const items: ApiFillWorkItem[] = [
    {
      batchId: "WEEKEND-2026-08-30",
      batch: stubBatch("WEEKEND-2026-08-30", [stubMatch("a1", fixtureId)]),
      match: stubMatch("a1", fixtureId),
      priority: 1,
    },
    {
      batchId: "WEEKEND-CORNERS-2026-08-30",
      batch: stubBatch("WEEKEND-CORNERS-2026-08-30", [stubMatch("b1", fixtureId)]),
      match: stubMatch("b1", fixtureId),
      priority: 1,
    },
    {
      batchId: "WEEKEND-HSH-2026-08-30",
      batch: stubBatch("WEEKEND-HSH-2026-08-30", [stubMatch("c1", fixtureId)]),
      match: stubMatch("c1", fixtureId),
      priority: 1,
    },
  ];

  const groups = groupApiFillWorkByFixture(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.items.length, 3);
});

test("propagateFillData copies stats and grades target predictions", () => {
  const source = stubMatch("src", 101, {
    predictions: {},
    teamStats: {
      home: { goals: 2, firstHalfGoals: 1, corners: 6 },
      away: { goals: 1, firstHalfGoals: 0, corners: 5 },
    },
    resultFilled: true,
    resultTraceState: "FILLED",
  });

  const target = stubMatch("tgt", 101, {
    predictions: { corners_ou: { prediction: "over", line: 9.5, confidence: 58 } },
  });

  const propagated = propagateFillData(source, target);
  assert.equal(propagated.teamStats?.home?.goals, 2);
  assert.equal(propagated.teamStats?.home?.corners, 6);
  assert.equal(propagated.resultFilled, true);
  assert.equal(propagated.scored.corners_ou, "correct");
});
