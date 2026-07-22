import assert from "node:assert/strict";
import { test } from "node:test";
import { apiSeasonFromDate } from "./leagues";
import {
  mapFixtureToUpcomingRow,
  selectUpcomingFixtures,
} from "./fetch-upcoming-league";
import {
  buildOneMatchBatchFromFixture,
  findBatchIdByApiFixtureId,
} from "./open-in-dm";
import type { ApiFootballFixture } from "./map-fixture-to-match";
import type { PredictionBatch } from "@/lib/prediction-log/types";

test("apiSeasonFromDate July 2026 → 2025", () => {
  assert.equal(apiSeasonFromDate("2026-07-22"), 2025);
});

test("apiSeasonFromDate August 2026 → 2026", () => {
  assert.equal(apiSeasonFromDate("2026-08-01"), 2026);
});

function fx(opts: {
  id: number;
  date: string;
  status: string;
  home?: string;
  away?: string;
}): ApiFootballFixture {
  return {
    fixture: {
      id: opts.id,
      date: opts.date,
      status: { short: opts.status },
      venue: { name: "Test Stadium" },
    },
    league: { id: 39, name: "Premier League" },
    teams: {
      home: { id: 1, name: opts.home ?? "Arsenal", logo: "https://example.com/h.png" },
      away: { id: 2, name: opts.away ?? "Chelsea", logo: "https://example.com/a.png" },
    },
    goals: { home: null, away: null },
    score: {},
  };
}

test("selectUpcomingFixtures filters NS/TBD sorts and caps", () => {
  const selected = selectUpcomingFixtures(
    [
      fx({ id: 3, date: "2026-08-20T15:00:00Z", status: "NS" }),
      fx({ id: 1, date: "2026-08-10T15:00:00Z", status: "NS" }),
      fx({ id: 2, date: "2026-08-12T15:00:00Z", status: "FT" }),
      fx({ id: 4, date: "2026-08-11T15:00:00Z", status: "TBD" }),
    ],
    2
  );
  assert.equal(selected.length, 2);
  assert.equal(selected[0]!.fixture.id, 1);
  assert.equal(selected[1]!.fixture.id, 4);
});

test("mapFixtureToUpcomingRow maps logos and venue", () => {
  const row = mapFixtureToUpcomingRow(
    fx({ id: 99, date: "2026-08-16T14:00:00Z", status: "NS" }),
    "Premier League",
    39
  );
  assert.equal(row.apiFixtureId, 99);
  assert.equal(row.matchDate, "2026-08-16");
  assert.equal(row.venue, "Test Stadium");
  assert.equal(row.home.logo, "https://example.com/h.png");
  assert.equal(row.leagueId, 39);
});

test("findBatchIdByApiFixtureId finds existing batch", () => {
  const batches = [
    {
      id: "b-old",
      matches: [{ apiFixtureId: 111 }],
    },
    {
      id: "b-hit",
      matches: [{ apiFixtureId: 222 }],
    },
  ] as PredictionBatch[];
  assert.equal(findBatchIdByApiFixtureId(batches, 222), "b-hit");
  assert.equal(findBatchIdByApiFixtureId(batches, 999), null);
});

test("buildOneMatchBatchFromFixture sets fixture metadata", () => {
  const batch = buildOneMatchBatchFromFixture({
    apiFixtureId: 555,
    matchDate: "2026-08-16",
    home: { id: 42, name: "Arsenal" },
    away: { id: 49, name: "Chelsea" },
    league: "Premier League",
    status: "NS",
  });
  assert.equal(batch.source, "web");
  assert.equal(batch.matches.length, 1);
  assert.equal(batch.matches[0]!.apiFixtureId, 555);
  assert.equal(batch.matches[0]!.matchDate, "2026-08-16");
  assert.equal(batch.date, "2026-08-16");
  assert.match(batch.batchName, /Arsenal vs Chelsea/);
});
