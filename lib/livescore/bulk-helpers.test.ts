import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BULK_LAST_N,
  buildExistingDedupeIndex,
  isDuplicateMatch,
  isFinishedStatus,
  isInSeasonWindow,
  lookbackDateKeys,
  matchDedupeKey,
  selectTopFinished,
  type BulkDiscoveredMatch,
} from "./bulk-helpers";
import type { PredictionBatch } from "@/lib/prediction-log/types";

test("isInSeasonWindow accepts 2025/26 dates only", () => {
  assert.equal(isInSeasonWindow("20250801"), true);
  assert.equal(isInSeasonWindow("20260731"), true);
  assert.equal(isInSeasonWindow("20250731"), false);
  assert.equal(isInSeasonWindow("20260801"), false);
  assert.equal(isInSeasonWindow("2026-07-10"), true);
});

test("isFinishedStatus recognizes FT variants", () => {
  assert.equal(isFinishedStatus("FT"), true);
  assert.equal(isFinishedStatus("AET"), true);
  assert.equal(isFinishedStatus("AP"), true);
  assert.equal(isFinishedStatus("NS"), false);
  assert.equal(isFinishedStatus("HT"), false);
});

test("selectTopFinished returns newest N unique events", () => {
  const rows: BulkDiscoveredMatch[] = [
    {
      eventId: "1",
      date: "2026-01-01",
      homeTeam: "A",
      awayTeam: "B",
      status: "FT",
    },
    {
      eventId: "2",
      date: "2026-01-08",
      homeTeam: "C",
      awayTeam: "D",
      status: "FT",
    },
    {
      eventId: "3",
      date: "2026-01-15",
      homeTeam: "E",
      awayTeam: "F",
      status: "FT",
    },
    {
      eventId: "4",
      date: "2026-01-22",
      homeTeam: "G",
      awayTeam: "H",
      status: "FT",
    },
    {
      eventId: "5",
      date: "2026-01-29",
      homeTeam: "I",
      awayTeam: "J",
      status: "FT",
    },
    {
      eventId: "6",
      date: "2026-02-05",
      homeTeam: "K",
      awayTeam: "L",
      status: "FT",
    },
    {
      eventId: "2",
      date: "2026-01-08",
      homeTeam: "C",
      awayTeam: "D",
      status: "FT",
    },
  ];
  const top = selectTopFinished(rows, BULK_LAST_N);
  assert.equal(top.length, 5);
  assert.equal(top[0]!.eventId, "6");
  assert.equal(top[4]!.eventId, "2");
});

test("dedupe by event id or pair+date", () => {
  const batch: PredictionBatch = {
    id: "b1",
    date: "2026-01-08",
    league: "Premier League",
    batchName: "t",
    createdAt: "2026-01-08T00:00:00.000Z",
    matches: [
      {
        id: "m1",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        predictions: {},
        actualResults: {},
        scored: {},
        livescoreEventId: "999",
      },
    ],
  };
  const index = buildExistingDedupeIndex([batch]);
  assert.equal(
    isDuplicateMatch(
      {
        eventId: "999",
        date: "2026-02-01",
        homeTeam: "X",
        awayTeam: "Y",
      },
      index
    ),
    true
  );
  assert.equal(
    isDuplicateMatch(
      {
        eventId: "1000",
        date: "2026-01-08",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
      },
      index
    ),
    true
  );
  assert.equal(
    isDuplicateMatch(
      {
        eventId: "1001",
        date: "2026-01-09",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
      },
      index
    ),
    false
  );
  assert.ok(matchDedupeKey("2026-01-08", "Arsenal", "Chelsea").startsWith("20260108|"));
});

test("lookbackDateKeys stays within season and caps length", () => {
  const keys = lookbackDateKeys(new Date(Date.UTC(2026, 6, 10)), 10);
  assert.ok(keys.length <= 10);
  assert.ok(keys.every((k) => isInSeasonWindow(k)));
  assert.equal(keys[0], "20260710");
});
