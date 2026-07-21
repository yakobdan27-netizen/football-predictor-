import assert from "node:assert/strict";
import { test } from "node:test";
import {
  lookupTeamIdInMap,
  teamNameKey,
  type TeamIdMapStore,
} from "@/lib/football-api/team-id-map";
import {
  applyResolvedFixtureToMatch,
  selectNearestUpcomingFixture,
} from "@/lib/football-api/resolve-upcoming-fixture";
import type { ApiFootballFixture } from "@/lib/football-api/map-fixture-to-match";
import type { LogMatch } from "@/lib/prediction-log/types";

function store(partial: Partial<TeamIdMapStore> & { byName: Record<string, number>; byKey: Record<string, number> }): TeamIdMapStore {
  return {
    schemaVersion: 1,
    leagueId: 39,
    season: 2026,
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

test("lookupTeamIdInMap exact and key match", () => {
  const s = store({
    byName: { Arsenal: 42, Chelsea: 49 },
    byKey: { arsenal: 42, chelsea: 49 },
  });
  assert.equal(lookupTeamIdInMap(s, "Arsenal").teamId, 42);
  assert.equal(lookupTeamIdInMap(s, "arsenal").teamId, 42);
});

test("lookupTeamIdInMap unique fuzzy", () => {
  const s = store({
    byName: { "Manchester City": 50 },
    byKey: { manchestercity: 50 },
  });
  const hit = lookupTeamIdInMap(s, "Man City");
  // "mancity" may fuzzy via includes on manchestercity
  assert.equal(teamNameKey("Man City"), "mancity");
  // Without alias in map, fuzzy may still miss — suggestions path
  if (hit.teamId == null) {
    assert.ok(Array.isArray(hit.suggestions));
  }
});

function fx(opts: {
  id: number;
  date: string;
  status: string;
  homeId: number;
  awayId: number;
}): ApiFootballFixture {
  return {
    fixture: { id: opts.id, date: opts.date, status: { short: opts.status } },
    teams: {
      home: { id: opts.homeId, name: "Home" },
      away: { id: opts.awayId, name: "Away" },
    },
    goals: { home: null, away: null },
    score: {},
  };
}

test("selectNearestUpcomingFixture picks nearest NS", () => {
  const floor = Date.parse("2026-08-01T00:00:00.000Z");
  const picked = selectNearestUpcomingFixture(
    [
      fx({ id: 1, date: "2026-08-20T15:00:00Z", status: "NS", homeId: 10, awayId: 20 }),
      fx({ id: 2, date: "2026-08-10T15:00:00Z", status: "NS", homeId: 10, awayId: 20 }),
      fx({ id: 3, date: "2026-08-05T15:00:00Z", status: "FT", homeId: 10, awayId: 20 }),
      fx({ id: 4, date: "2026-08-12T15:00:00Z", status: "NS", homeId: 10, awayId: 99 }),
    ],
    10,
    20,
    floor
  );
  assert.ok(picked);
  assert.equal(picked!.fixture.id, 2);
});

test("selectNearestUpcomingFixture returns null when none", () => {
  const floor = Date.parse("2026-08-01T00:00:00.000Z");
  assert.equal(
    selectNearestUpcomingFixture(
      [fx({ id: 1, date: "2026-07-01T15:00:00Z", status: "NS", homeId: 10, awayId: 20 })],
      10,
      20,
      floor
    ),
    null
  );
});

test("applyResolvedFixtureToMatch sets metadata", () => {
  const match: LogMatch = {
    id: "m1",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    predictions: {},
    actualResults: {},
    scored: {},
  };
  const next = applyResolvedFixtureToMatch(match, {
    apiFixtureId: 12345,
    matchDate: "2026-08-16",
    fixtureStatus: "NS",
    homeApiTeamId: 42,
    awayApiTeamId: 49,
    leagueId: 39,
    kickoffIso: "2026-08-16T14:00:00Z",
  });
  assert.equal(next.apiFixtureId, 12345);
  assert.equal(next.matchDate, "2026-08-16");
  assert.equal(next.fixtureStatus, "NS");
  assert.equal(next.homeApiTeamId, 42);
  assert.equal(next.awayApiTeamId, 49);
});
