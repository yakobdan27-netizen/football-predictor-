import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectApiFillWorkItems,
  matchFillPriority,
} from "./sync-batch-api-fill";
import { batchDateIsPastOrToday } from "./sync-batch-persist";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";

function batch(
  id: string,
  date: string,
  matches: LogMatch[]
): PredictionBatch {
  return {
    id,
    date,
    league: "Premier League",
    batchName: id,
    createdAt: "2026-01-01T00:00:00Z",
    batchKind: "manual",
    source: "web",
    matches,
  };
}

function match(
  id: string,
  extra?: Partial<LogMatch>
): LogMatch {
  return {
    id,
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    predictions: {},
    actualResults: {},
    scored: {},
    ...extra,
  };
}

test("batchDateIsPastOrToday accepts today and past ISO dates", () => {
  const today = new Date();
  const iso = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
  assert.equal(batchDateIsPastOrToday(iso), true);
  assert.equal(batchDateIsPastOrToday("2020-01-01"), true);
});

test("batchDateIsPastOrToday rejects far-future batch dates", () => {
  assert.equal(batchDateIsPastOrToday("2099-12-31"), false);
});

test("matchFillPriority ranks FOUND_NOT_FINAL before FILLED-with-gaps", () => {
  const notFinal = match("m1", {
    resultTraceState: "FOUND_NOT_FINAL",
    resultFilled: false,
    teamStats: { home: { goals: 1 }, away: { goals: 0 } },
  });
  const filledMissingCorners = match("m2", {
    resultFilled: true,
    resultTraceState: "FILLED",
    teamStats: { home: { goals: 2 }, away: { goals: 1 } },
  });
  assert.ok(matchFillPriority(notFinal) < matchFillPriority(filledMissingCorners));
});

test("collectApiFillWorkItems skips future batches and sorts by priority", () => {
  const items = collectApiFillWorkItems([
    batch("future", "2099-01-01", [match("m-future")]),
    batch("past", "2026-01-01", [
      match("m-low", {
        resultFilled: true,
        resultTraceState: "FILLED",
        teamStats: { home: { goals: 1, corners: 2 }, away: { goals: 0, corners: 1 } },
      }),
      match("m-high", {
        resultTraceState: "FOUND_NOT_FINAL",
        resultFilled: false,
      }),
    ]),
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0]!.match.id, "m-high");
  assert.equal(items[1]!.match.id, "m-low");
});

test("collectApiFillWorkItems respects batchId scope", () => {
  const items = collectApiFillWorkItems(
    [
      batch("a", "2026-01-01", [match("m1")]),
      batch("b", "2026-01-01", [match("m2")]),
    ],
    { batchId: "b" }
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]!.batchId, "b");
});
