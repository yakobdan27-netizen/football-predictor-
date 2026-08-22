import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeLiveDataIntoMatch } from "./sync-from-live-fixtures";
import type { LogMatch } from "@/lib/prediction-log/types";
import type { liveFixtures, matchStats } from "@/lib/db/schema";

type LiveRow = typeof liveFixtures.$inferSelect;
type StatsRow = typeof matchStats.$inferSelect;

function liveRow(overrides: Partial<LiveRow> = {}): LiveRow {
  return {
    fixtureId: 12345,
    leagueId: 39,
    season: 2026,
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    homeId: 1,
    awayId: 2,
    kickoffUtc: new Date("2026-03-15T15:00:00Z"),
    venue: null,
    status: "FT",
    statusMinute: null,
    homeGoals: 2,
    awayGoals: 1,
    besoccerMatchId: null,
    homeCorners: 6,
    awayCorners: 4,
    homeShots: 12,
    awayShots: 8,
    homePossession: 58,
    awayPossession: 42,
    sourceConflicts: null,
    lastSyncedUtc: new Date(),
    settledEmittedAt: null,
    ...overrides,
  };
}

test("mergeLiveDataIntoMatch fills empty FT goals and corners", () => {
  const match: LogMatch = {
    id: "m1",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    apiFixtureId: 12345,
    predictions: {},
    actualResults: {},
    scored: {},
    resultTraceState: "PENDING",
    resultFilled: false,
  };
  const merged = mergeLiveDataIntoMatch(match, liveRow(), null);
  assert.equal(merged.teamStats?.home?.goals, 2);
  assert.equal(merged.teamStats?.away?.goals, 1);
  assert.equal(merged.teamStats?.home?.corners, 6);
  assert.equal(merged.teamStats?.away?.corners, 4);
  assert.equal(merged.resultTraceState, "FILLED");
  assert.equal(merged.resultFilled, true);
});

test("mergeLiveDataIntoMatch does not overwrite manual FT settlement", () => {
  const match: LogMatch = {
    id: "m1",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    apiFixtureId: 12345,
    predictions: {},
    actualResults: {},
    scored: {},
    resultSource: "manual",
    teamStats: { home: { goals: 3 }, away: { goals: 0 } },
    resultFilled: true,
    resultTraceState: "FILLED",
  };
  const merged = mergeLiveDataIntoMatch(match, liveRow(), null);
  assert.equal(merged.teamStats?.home?.goals, 3);
  assert.equal(merged.teamStats?.away?.goals, 0);
  assert.equal(merged.teamStats?.home?.corners, undefined);
});

test("mergeLiveDataIntoMatch merges match_stats shots on target when empty", () => {
  const match: LogMatch = {
    id: "m1",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    apiFixtureId: 12345,
    predictions: {},
    actualResults: {},
    scored: {},
    teamStats: { home: { goals: 2 }, away: { goals: 1 } },
    resultFilled: true,
    resultTraceState: "FILLED",
  };
  const stats: StatsRow = {
    fixtureId: 12345,
    statsApiMatchId: null,
    leagueId: 39,
    season: 2026,
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    kickoffUtc: new Date(),
    status: "FT",
    homeGoals: 2,
    awayGoals: 1,
    homeCorners: 6,
    awayCorners: 4,
    homeShots: 12,
    awayShots: 8,
    homePossession: 58,
    awayPossession: 42,
    homeShotsOnTarget: 5,
    awayShotsOnTarget: 3,
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
    sourceConflicts: null,
    provider: "thestatsapi",
    fetchedAt: new Date(),
    updatedAt: new Date(),
  };
  const merged = mergeLiveDataIntoMatch(match, liveRow(), stats);
  assert.equal(merged.teamStats?.home?.shotsOnTarget, 5);
  assert.equal(merged.teamStats?.away?.shotsOnTarget, 3);
});
