import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendFixtureMatches,
  draftHasApiFixtureId,
  logMatchFromUpcomingFixture,
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
