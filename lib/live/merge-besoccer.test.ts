import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStatsApiMatchStats, parseStatsApiMatchList } from "../stats-api/parse";
import { mapStatsApiIds } from "../stats-api/map-ids";
import { mergeLiveSources } from "./merge-besoccer";
import type { LiveApiFixture } from "./types";

test("parseStatsApiMatchStats reads overview corner/shots/possession", () => {
  const m = parseStatsApiMatchStats({
    matchId: "mt_1",
    detail: {
      data: {
        id: "mt_1",
        status: "finished",
        utc_date: "2025-08-16T14:00:00.000Z",
        home_team: { name: "Arsenal" },
        away_team: { name: "Chelsea" },
        score: { home: 2, away: 1 },
      },
    },
    statsPayload: {
      data: {
        match_id: "mt_1",
        overview: {
          corner_kicks: { all: { home: 5, away: 3 } },
          total_shots: { all: { home: 12, away: 8 } },
          ball_possession: { all: { home: 55, away: 45 } },
          expected_goals: { all: { home: 1.84, away: 0.97 } },
          shots_on_target: { all: { home: 6, away: 2 } },
          yellow_cards: { all: { home: 1, away: 3 } },
        },
      },
    },
  });
  assert.ok(m);
  assert.equal(m!.homeGoals, 2);
  assert.equal(m!.homeCorners, 5);
  assert.equal(m!.homeShots, 12);
  assert.equal(m!.homePossession, 55);
  assert.equal(m!.homeXg, 1.84);
  assert.equal(m!.homeShotsOnTarget, 6);
  assert.equal(m!.awayYellowCards, 3);
});

test("mergeLiveSources gap-fills and flags conflicts", () => {
  const af: LiveApiFixture = {
    fixture: {
      id: 1001,
      date: "2026-08-16T14:00:00+00:00",
      status: { short: "2H", elapsed: 70 },
    },
    league: { id: 39, name: "Premier League", season: 2025 },
    teams: {
      home: { id: 42, name: "Arsenal" },
      away: { id: 49, name: "Chelsea" },
    },
    goals: { home: 1, away: 0 },
  };

  const mergedConflict = mergeLiveSources(
    af,
    {
      id: "mt_99",
      year: 2025,
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      homeGoals: 2,
      awayGoals: 0,
      status: null,
      minute: null,
      date: null,
      homeCorners: 4,
      awayCorners: 2,
      homeShots: null,
      awayShots: null,
      homePossession: null,
      awayPossession: null,
      homeShotsOnTarget: null,
      awayShotsOnTarget: null,
      homeXg: null,
      awayXg: null,
      homeBigChances: null,
      awayBigChances: null,
      homeGkSaves: null,
      awayGkSaves: null,
      homeFouls: null,
      awayFouls: null,
      homeYellowCards: null,
      awayYellowCards: null,
      homeRedCards: null,
      awayRedCards: null,
      homePasses: null,
      awayPasses: null,
      homeAccuratePasses: null,
      awayAccuratePasses: null,
      homeTackles: null,
      awayTackles: null,
      homeFreeKicks: null,
      awayFreeKicks: null,
      rawJson: null,
    },
    "mt_99"
  );
  assert.equal(mergedConflict.fixture.goals.home, 1);
  assert.equal(mergedConflict.enrichment.sourceConflicts.length, 1);
  assert.equal(mergedConflict.enrichment.besoccerMatchId, "mt_99");
  assert.equal(mergedConflict.enrichment.homeCorners, 4);
});

test("mapStatsApiIds matches by team names", () => {
  const map = mapStatsApiIds(
    [
      {
        fixtureId: 1,
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        kickoffUtc: "2026-08-16T14:00:00.000Z",
      },
    ],
    [
      {
        id: "mt_49593",
        year: 2025,
        homeTeam: "Arsenal FC",
        awayTeam: "Chelsea",
        date: "2026-08-16T14:00:00.000Z",
        homeGoals: null,
        awayGoals: null,
        status: "scheduled",
      },
    ]
  );
  assert.equal(map.get(1), "mt_49593");
});

test("parseStatsApiMatchList reads list payload", () => {
  const rows = parseStatsApiMatchList({
    data: [
      {
        id: "mt_a",
        utc_date: "2026-07-28T12:00:00.000Z",
        status: "live",
        home_team: { name: "Home" },
        away_team: { name: "Away" },
        score: { home: 0, away: 1 },
      },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.id, "mt_a");
  assert.equal(rows[0]!.awayGoals, 1);
});
