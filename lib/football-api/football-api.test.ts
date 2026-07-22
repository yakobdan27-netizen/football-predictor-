import assert from "node:assert/strict";
import { applyTeamStatsSync } from "@/lib/prediction-log/team-stats-sync";
import { scoreMatch } from "@/lib/prediction-log/scoring";
import type { LogMatch } from "@/lib/prediction-log/types";
import {
  type ApiFootballFixture,
  type ApiFootballStatBlock,
  detectApiConflicts,
  mapFixtureToMatchUpdates,
  matchNeedsStatistics,
  mergeMatchUpdates,
  parseFixtureStatistics,
} from "./map-fixture-to-match";
import { resolveToAppTeam, fixturePairKey } from "./team-resolve";
import { indexFixtures } from "./sync-prediction-log";
import { apiSeasonFromDate, apiLeagueId, fixturesCacheKey } from "./leagues";

const sampleFixture: ApiFootballFixture = {
  fixture: { id: 1, date: "2026-03-15T15:00:00+00:00", status: { short: "FT" } },
  teams: { home: { name: "Manchester City" }, away: { name: "Chelsea" } },
  goals: { home: 2, away: 1 },
  score: { halftime: { home: 1, away: 0 } },
};

/** Away block listed first — must still map by team name. */
const reversedStats: ApiFootballStatBlock[] = [
  {
    team: { name: "Chelsea" },
    statistics: [
      { type: "Total Shots", value: 9 },
      { type: "Shots on Goal", value: 3 },
      { type: "Corner Kicks", value: 4 },
      { type: "Offsides", value: 1 },
    ],
  },
  {
    team: { name: "Manchester City" },
    statistics: [
      { type: "Total Shots", value: 14 },
      { type: "Shots on Goal", value: 6 },
      { type: "Corner Kicks", value: 7 },
      { type: "Offsides", value: 2 },
    ],
  },
];

assert.equal(resolveToAppTeam("Manchester United", "Premier League"), "Man United");
assert.equal(resolveToAppTeam("Manchester City", "Premier League"), "Man City");

// Starting-year season (2025/26 → 2025)
assert.equal(apiSeasonFromDate("2026-03-15"), 2025);
assert.equal(apiSeasonFromDate("2025-09-01"), 2025);
assert.equal(apiSeasonFromDate("2025-07-31"), 2024);
assert.equal(apiSeasonFromDate("2025-08-01"), 2025);
assert.equal(apiLeagueId("UEFA Europa League"), 3);
assert.equal(apiLeagueId("UEFA Champions League"), 2);
assert.equal(apiLeagueId("UEFA Europa Conference League"), 848);
assert.equal(apiLeagueId("Premier League"), 39);
assert.equal(apiLeagueId("Ligue 1"), 61);

assert.equal(fixturesCacheKey(39, 2025, "2026-03-15"), "39:2025:2026-03-15");
assert.equal(fixturesCacheKey(null, 2025, "2026-03-15"), "all:2025:2026-03-15");

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
  {
    fixture: { id: 12, date: "2026-03-15T12:00:00+00:00", status: { short: "NS" } },
    teams: { home: { name: "Tottenham" }, away: { name: "Everton" } },
    goals: { home: null, away: null },
    score: {},
  },
];
const fixtureIndex = indexFixtures(sameDayFixtures);
assert.equal(fixtureIndex.get(fixturePairKey("Man City", "Chelsea"))?.fixture.id, 10);
assert.equal(fixtureIndex.get(fixturePairKey("Arsenal", "Liverpool"))?.fixture.id, 11);
assert.equal(fixtureIndex.get(fixturePairKey("Tottenham", "Everton")), undefined);
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
  },
  actualResults: {},
  scored: {},
};

// Corners needed even without corners_ou prediction
assert.equal(matchNeedsStatistics(baseMatch), true);

const updates = mapFixtureToMatchUpdates(sampleFixture, reversedStats, baseMatch);
assert.equal(updates.actualResults?.["1x2"]?.actual, "home");
assert.equal(updates.actualResults?.btts?.actual, "yes");
assert.equal(updates.actualResults?.ht_1x2?.actual, "home");
assert.equal(updates.actualResults?.double_chance?.actual, "1x");
assert.equal(updates.teamStats?.home?.totalShots, 14);
assert.equal(updates.teamStats?.home?.corners, 7);
assert.equal(updates.teamStats?.away?.corners, 4);
assert.equal(updates.teamStats?.home?.firstHalfGoals, 1);
assert.equal(updates.teamStats?.away?.firstHalfGoals, 0);

let merged = mergeMatchUpdates(baseMatch, updates);
merged = applyTeamStatsSync(scoreMatch(merged));
assert.equal(merged.teamStats?.home?.corners, 7);

const withManual: LogMatch = {
  ...baseMatch,
  actualResults: { "1x2": { actual: "away" } },
  teamStats: {
    home: { goals: 0, corners: 3 },
    away: { goals: 0, corners: 2 },
  },
};
const noOverwrite = mapFixtureToMatchUpdates(sampleFixture, reversedStats, withManual);
assert.equal(noOverwrite.actualResults?.["1x2"]?.actual, "away");
assert.equal(noOverwrite.teamStats?.home?.goals, 0);
assert.equal(noOverwrite.teamStats?.home?.corners, 3);
assert.equal(noOverwrite.actualResults?.btts?.actual, "yes");

const conflicts = detectApiConflicts(withManual, sampleFixture, reversedStats);
assert.ok(conflicts.some((c) => c.field === "home.goals"));
assert.ok(conflicts.some((c) => c.field === "home.corners"));

const overwritten = mapFixtureToMatchUpdates(sampleFixture, reversedStats, withManual, {
  overwrite: true,
});
assert.equal(overwritten.teamStats?.home?.goals, 2);
assert.equal(overwritten.teamStats?.home?.corners, 7);
assert.equal(overwritten.resultSource, "api-football");

const manualSettled: LogMatch = {
  ...baseMatch,
  resultSource: "manual",
  actualResults: { "1x2": { actual: "away" } },
  teamStats: {
    home: { goals: 0, firstHalfGoals: 0, corners: 3 },
    away: { goals: 1, firstHalfGoals: 0, corners: 2 },
  },
};
const keepManual = mapFixtureToMatchUpdates(sampleFixture, reversedStats, manualSettled);
assert.equal(keepManual.resultSource, "manual");
assert.equal(keepManual.teamStats?.home?.goals, 0);
assert.equal(keepManual.teamStats?.away?.goals, 1);
assert.equal(keepManual.teamStats?.home?.firstHalfGoals, 0);
assert.equal(keepManual.actualResults?.["1x2"]?.actual, "away");
// Empty stats fields may still fill; corners already set stay.
assert.equal(keepManual.teamStats?.home?.corners, 3);
assert.equal(keepManual.teamStats?.home?.totalShots, 14);

const parsed = parseFixtureStatistics(
  reversedStats,
  "Manchester City",
  "Chelsea"
);
assert.equal(parsed.home.shotsOnTarget, 6);
assert.equal(parsed.home.corners, 7);
assert.equal(parsed.away.offsides, 1);
assert.equal(parsed.away.corners, 4);

console.log("football-api tests passed");
