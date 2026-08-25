import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendFixtureMatches,
  buildUpcomingPredictionBatch,
  draftHasApiFixtureId,
  filterUpcomingNext7Days,
  logMatchFromUpcomingFixture,
  sortDedupeUpcomingFixtures,
} from "./batch-fixture-picker";
import type { CombinedOddsSettings, LogMatch } from "./types";
import type { UpcomingFixtureRow } from "@/lib/football-api/fetch-upcoming-league";

const settings = {
  defaultMarketMode: "single",
} as CombinedOddsSettings;

const row: UpcomingFixtureRow = {
  apiFixtureId: 12345,
  kickoffIso: "2026-08-16T14:00:00Z",
  matchDate: "2026-08-16",
  status: "NS",
  home: { id: 42, name: "Arsenal", logo: null },
  away: { id: 49, name: "Chelsea", logo: null },
  venue: "Emirates",
  league: "Premier League",
  leagueId: 39,
};

test("logMatchFromUpcomingFixture copies fixture metadata", () => {
  const m = logMatchFromUpcomingFixture(row, { id: "m1", settings });
  assert.equal(m.id, "m1");
  assert.equal(m.homeTeam, "Arsenal");
  assert.equal(m.awayTeam, "Chelsea");
  assert.equal(m.league, "Premier League");
  assert.equal(m.apiFixtureId, 12345);
  assert.equal(m.matchDate, "2026-08-16");
  assert.equal(m.fixtureStatus, "NS");
  assert.equal(m.homeApiTeamId, 42);
  assert.equal(m.awayApiTeamId, 49);
  assert.deepEqual(m.predictions, {});
});

test("draftHasApiFixtureId detects duplicates", () => {
  const matches: Pick<LogMatch, "apiFixtureId">[] = [
    { apiFixtureId: 1 },
    { apiFixtureId: 12345 },
  ];
  assert.equal(draftHasApiFixtureId(matches, 12345), true);
  assert.equal(draftHasApiFixtureId(matches, 99), false);
});

test("appendFixtureMatches drops blank placeholders", () => {
  const blank: LogMatch = {
    id: "blank",
    homeTeam: "",
    awayTeam: "",
    predictions: {},
    actualResults: {},
    scored: {},
  };
  const filled = logMatchFromUpcomingFixture(row, { id: "fx", settings });
  const next = appendFixtureMatches([blank], [filled]);
  assert.equal(next.length, 1);
  assert.equal(next[0]!.apiFixtureId, 12345);
});

const plRow: UpcomingFixtureRow = { ...row };
const laLigaRow: UpcomingFixtureRow = {
  ...row,
  apiFixtureId: 99999,
  kickoffIso: "2026-08-15T18:00:00Z",
  matchDate: "2026-08-15",
  home: { id: 529, name: "Barcelona", logo: null },
  away: { id: 530, name: "Real Madrid", logo: null },
  league: "La Liga",
  leagueId: 140,
};

test("sortDedupeUpcomingFixtures sorts by kickoff and dedupes", () => {
  const dup: UpcomingFixtureRow = { ...plRow, kickoffIso: "2026-08-16T20:00:00Z" };
  const sorted = sortDedupeUpcomingFixtures([laLigaRow, plRow, dup]);
  assert.equal(sorted.length, 2);
  assert.equal(sorted[0]!.apiFixtureId, laLigaRow.apiFixtureId);
  assert.equal(sorted[1]!.apiFixtureId, plRow.apiFixtureId);
});

test("buildUpcomingPredictionBatch produces Mixed league batch", () => {
  const batch = buildUpcomingPredictionBatch([laLigaRow, plRow], {
    batchId: "UPCOMING-TEST",
  });
  assert.ok(batch);
  assert.equal(batch!.league, "Mixed");
  assert.equal(batch!.matches.length, 2);
  assert.equal(batch!.matches[0]!.league, "La Liga");
  assert.equal(batch!.matches[1]!.league, "Premier League");
  assert.equal(batch!.batchName, "Upcoming (API)");
  assert.equal(batch!.id, "UPCOMING-TEST");
});

test("buildUpcomingPredictionBatch returns null for empty input", () => {
  assert.equal(buildUpcomingPredictionBatch([]), null);
});

test("filterUpcomingNext7Days keeps fixtures within seven-day window", () => {
  const now = new Date("2026-08-16T12:00:00");
  const inside: UpcomingFixtureRow = {
    ...row,
    apiFixtureId: 1,
    kickoffIso: "2026-08-18T15:00:00Z",
  };
  const outside: UpcomingFixtureRow = {
    ...row,
    apiFixtureId: 2,
    kickoffIso: "2026-08-30T15:00:00Z",
  };
  const filtered = filterUpcomingNext7Days([inside, outside], now);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.apiFixtureId, 1);
});
