import assert from "node:assert/strict";
import { applyTeamStatsSync } from "@/lib/prediction-log/team-stats-sync";
import { scoreMatch } from "@/lib/prediction-log/scoring";
import type { LogMatch } from "@/lib/prediction-log/types";
import {
  type ApiFootballFixture,
  type ApiFootballStatBlock,
  mapFixtureToMatchUpdates,
  mergeMatchUpdates,
  parseFixtureStatistics,
} from "./map-fixture-to-match";
import { resolveToAppTeam, fixturePairKey } from "./team-resolve";
import { indexFixtures } from "./sync-prediction-log";
import { apiSeasonFromDate, apiLeagueId } from "./leagues";

const sampleFixture: ApiFootballFixture = {
  fixture: { id: 1, date: "2026-03-15T15:00:00+00:00", status: { short: "FT" } },
  teams: { home: { name: "Manchester City" }, away: { name: "Chelsea" } },
  goals: { home: 2, away: 1 },
  score: { halftime: { home: 1, away: 0 } },
};

const sampleStats: ApiFootballStatBlock[] = [
  {
    team: { name: "Manchester City" },
    statistics: [
      { type: "Total Shots", value: 14 },
      { type: "Shots on Goal", value: 6 },
      { type: "Corner Kicks", value: 7 },
      { type: "Offsides", value: 2 },
    ],
  },
  {
    team: { name: "Chelsea" },
    statistics: [
      { type: "Total Shots", value: 9 },
      { type: "Shots on Goal", value: 3 },
      { type: "Corner Kicks", value: 4 },
      { type: "Offsides", value: 1 },
    ],
  },
];

assert.equal(resolveToAppTeam("Manchester United", "Premier League"), "Man United");
assert.equal(resolveToAppTeam("Manchester City", "Premier League"), "Man City");

assert.equal(apiSeasonFromDate("2026-03-15"), 2026);
assert.equal(apiSeasonFromDate("2026-09-01"), 2027);
assert.equal(apiLeagueId("UEFA Europa League"), 3);
assert.equal(apiLeagueId("UEFA Champions League"), 2);
assert.equal(apiLeagueId("UEFA Europa Conference League"), 848);

assert.equal(fixturePairKey("Manchester City", "Chelsea"), fixturePairKey("Man City", "Chelsea"));
assert.notEqual(fixturePairKey("Man City", "Chelsea"), fixturePairKey("Chelsea", "Man City"));

const sameDayFixtures: ApiFootballFixture[] = [
  {
    fixture: { id: 10, date: "2026-03-15T15:00:00+00:00", status: { short: "FT" } },
    teams: { home: { name: "Manchester City" }, away: { name: "Chelsea" } },
    goals: { home: 2, away: 1 },
    score: {},
  },
  {
    fixture: { id: 11, date: "2026-03-15T17:30:00+00:00", status: { short: "FT" } },
    teams: { home: { name: "Arsenal" }, away: { name: "Liverpool" } },
    goals: { home: 1, away: 1 },
    score: {},
  },
];
const fixtureIndex = indexFixtures(sameDayFixtures);
assert.equal(fixtureIndex.get(fixturePairKey("Man City", "Chelsea"))?.fixture.id, 10);
assert.equal(fixtureIndex.get(fixturePairKey("Arsenal", "Liverpool"))?.fixture.id, 11);
assert.equal(fixtureIndex.get(fixturePairKey("Chelsea", "Man City")), undefined);

const baseMatch: LogMatch = {
  id: "m1",
  homeTeam: "Man City",
  awayTeam: "Chelsea",
  predictions: {
    "1x2": { prediction: "home", confidence: 70 },
    btts: { prediction: "yes", confidence: 60 },
    ht_1x2: { prediction: "home", confidence: 55 },
    double_chance: { prediction: "1x", confidence: 65 },
    corners_ou: { prediction: "over", line: 9.5, confidence: 50 },
  },
  actualResults: {},
  scored: {},
};

const updates = mapFixtureToMatchUpdates(sampleFixture, sampleStats, baseMatch);
assert.equal(updates.actualResults?.["1x2"]?.actual, "home");
assert.equal(updates.actualResults?.btts?.actual, "yes");
assert.equal(updates.actualResults?.ht_1x2?.actual, "home");
assert.equal(updates.actualResults?.double_chance?.actual, "1x");
assert.equal(updates.teamStats?.home?.totalShots, 14);
assert.equal(updates.teamStats?.away?.corners, 4);

let merged = mergeMatchUpdates(baseMatch, updates);
merged = applyTeamStatsSync(scoreMatch(merged));
assert.equal(merged.actualResults.corners_ou?.actual, 11);
assert.equal(merged.scored.corners_ou, "correct");

const withManual: LogMatch = {
  ...baseMatch,
  actualResults: { "1x2": { actual: "away" } },
};
const noOverwrite = mapFixtureToMatchUpdates(sampleFixture, null, withManual);
assert.equal(noOverwrite.actualResults?.["1x2"]?.actual, "away");
assert.equal(noOverwrite.actualResults?.btts?.actual, "yes");

const parsed = parseFixtureStatistics(sampleStats);
assert.equal(parsed.home.shotsOnTarget, 6);
assert.equal(parsed.away.offsides, 1);

console.log("football-api tests passed");
