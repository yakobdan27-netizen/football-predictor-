import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiFootballFixture } from "./map-fixture-to-match";
import {
  filterEligibleFixtures,
  isMensTopFlightFixture,
  isRegularLeagueRound,
  isYouthOrWomenTeamName,
} from "./fixture-eligibility";

const PL_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

function fx(overrides: Partial<ApiFootballFixture> & { homeId?: number; awayId?: number }): ApiFootballFixture {
  const homeId = overrides.homeId ?? 1;
  const awayId = overrides.awayId ?? 2;
  return {
    fixture: {
      id: 100,
      date: "2026-08-23T15:00:00Z",
      status: { short: "NS" },
      ...(overrides.fixture ?? {}),
    },
    league: {
      id: 39,
      name: "Premier League",
      type: "League",
      round: "Regular Season - 1",
      ...(overrides.league ?? {}),
    },
    teams: {
      home: { id: homeId, name: overrides.teams?.home?.name ?? "Arsenal" },
      away: { id: awayId, name: overrides.teams?.away?.name ?? "Chelsea" },
    },
    goals: { home: null, away: null },
    score: {},
    ...overrides,
  };
}

const ctx = {
  expectedLeagueId: 39,
  season: 2026,
  allowedTeamIds: PL_IDS,
};

test("isYouthOrWomenTeamName detects women and youth squads", () => {
  assert.equal(isYouthOrWomenTeamName("Barcelona W"), true);
  assert.equal(isYouthOrWomenTeamName("Arsenal U21"), true);
  assert.equal(isYouthOrWomenTeamName("Arsenal"), false);
});

test("isRegularLeagueRound allows regular season and rejects friendlies", () => {
  assert.equal(isRegularLeagueRound("Regular Season - 1"), true);
  assert.equal(isRegularLeagueRound("Matchday 5"), true);
  assert.equal(isRegularLeagueRound("Club Friendlies 1"), false);
  assert.equal(isRegularLeagueRound(undefined), true);
});

test("isMensTopFlightFixture keeps valid league fixture", () => {
  assert.equal(isMensTopFlightFixture(fx({ homeId: 1, awayId: 2 }), ctx), true);
});

test("isMensTopFlightFixture drops cup type", () => {
  assert.equal(
    isMensTopFlightFixture(fx({ league: { id: 39, type: "Cup" } }), ctx),
    false
  );
});

test("isMensTopFlightFixture drops friendly round", () => {
  assert.equal(
    isMensTopFlightFixture(
      fx({ league: { id: 39, type: "League", round: "Club Friendlies 1" } }),
      ctx
    ),
    false
  );
});

test("isMensTopFlightFixture drops team not in roster", () => {
  assert.equal(
    isMensTopFlightFixture(fx({ homeId: 999, awayId: 2 }), ctx),
    false
  );
});

test("isMensTopFlightFixture drops women team name", () => {
  assert.equal(
    isMensTopFlightFixture(
      fx({ teams: { home: { id: 1, name: "Barcelona W" }, away: { id: 2, name: "Chelsea" } } }),
      ctx
    ),
    false
  );
});

test("isMensTopFlightFixture keeps when round/type missing but team ids valid", () => {
  assert.equal(
    isMensTopFlightFixture(
      fx({ league: { id: 39, name: "Premier League" } }),
      ctx
    ),
    true
  );
});

test("filterEligibleFixtures aggregates drop reasons", () => {
  const { kept, dropped, reasonsByCode } = filterEligibleFixtures(
    [
      fx({ homeId: 1, awayId: 2 }),
      fx({ homeId: 999, awayId: 2 }),
      fx({ league: { id: 39, type: "Cup" } }),
    ],
    ctx
  );
  assert.equal(kept.length, 1);
  assert.equal(dropped, 2);
  assert.equal(reasonsByCode.team_not_in_roster, 1);
  assert.equal(reasonsByCode.not_league_type, 1);
});
