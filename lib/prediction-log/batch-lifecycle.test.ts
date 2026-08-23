import assert from "node:assert/strict";
import { test } from "node:test";
import {
  batchAllMatchesFinished,
  matchHasFinalResult,
} from "./batch-lifecycle";
import type { LogMatch, PredictionBatch } from "./types";

function finishedMatch(id: string): LogMatch {
  return {
    id,
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    predictions: {},
    actualResults: {},
    scored: {},
    resultFilled: true,
    resultTraceState: "FILLED",
    teamStats: { home: { goals: 2 }, away: { goals: 1 } },
  };
}

function pendingMatch(id: string): LogMatch {
  return {
    id,
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    predictions: {},
    actualResults: {},
    scored: {},
    resultTraceState: "PENDING",
    resultFilled: false,
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

test("matchHasFinalResult requires FT goals and filled trace state", () => {
  assert.equal(matchHasFinalResult(finishedMatch("m1")), true);
  assert.equal(
    matchHasFinalResult({
      ...finishedMatch("m1"),
      resultFilled: false,
      resultTraceState: "PENDING",
    }),
    false
  );
  assert.equal(
    matchHasFinalResult({
      ...finishedMatch("m1"),
      teamStats: { home: { goals: 1 }, away: {} },
    }),
    false
  );
});

test("batchAllMatchesFinished is true when every match is FT-filled and date is past", () => {
  assert.equal(
    batchAllMatchesFinished(batch([finishedMatch("m1"), finishedMatch("m2")])),
    true
  );
});

test("batchAllMatchesFinished is false when any match pending or batch is future-dated", () => {
  assert.equal(
    batchAllMatchesFinished(batch([finishedMatch("m1"), pendingMatch("m2")])),
    false
  );
  assert.equal(batchAllMatchesFinished(batch([], "2026-03-01")), false);

  const future = new Date();
  future.setUTCDate(future.getUTCDate() + 14);
  const y = future.getUTCFullYear();
  const m = String(future.getUTCMonth() + 1).padStart(2, "0");
  const d = String(future.getUTCDate()).padStart(2, "0");
  assert.equal(
    batchAllMatchesFinished(batch([finishedMatch("m1")], `${y}-${m}-${d}`)),
    false
  );
});
