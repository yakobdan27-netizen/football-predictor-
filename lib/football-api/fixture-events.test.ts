import assert from "node:assert/strict";
import { test } from "node:test";
import {
  firstGoalSideFromEvents,
  goalTimingFromEvents,
  type FixtureGoalEvent,
} from "./fixture-events";
import {
  mapFixtureToMatchUpdates,
  matchNeedsApiDetailFill,
  matchNeedsGoalEvents,
  type ApiFootballFixture,
  type ApiFootballStatBlock,
} from "./map-fixture-to-match";
import type { LogMatch } from "@/lib/prediction-log/types";

test("goalTimingFromEvents builds buckets and first/last flags", () => {
  const events: FixtureGoalEvent[] = [
    { minute: 8, team: "Home FC", player: "A", detail: null },
    { minute: 55, team: "Away FC", player: "B", detail: null },
    { minute: 82, team: "Home FC", player: "C", detail: null },
  ];
  const out = goalTimingFromEvents(events);
  assert.equal(out.goalInFirst10, true);
  assert.equal(out.goalInLast10, true);
  assert.equal(out.timingBuckets?.g0_15, 1);
  assert.equal(out.timingBuckets?.g46_60, 1);
  assert.equal(out.timingBuckets?.g76_90plus, 1);
});

test("goalTimingFromEvents sets false when no early or late goals", () => {
  const events: FixtureGoalEvent[] = [
    { minute: 25, team: "Home FC", player: "A", detail: null },
    { minute: 40, team: "Away FC", player: "B", detail: null },
  ];
  const out = goalTimingFromEvents(events);
  assert.equal(out.goalInFirst10, false);
  assert.equal(out.goalInLast10, false);
});

test("firstGoalSideFromEvents picks earliest goal team", () => {
  const events: FixtureGoalEvent[] = [
    { minute: 70, team: "Away FC", player: "B", detail: null },
    { minute: 12, team: "Manchester City", player: "A", detail: null },
  ];
  assert.equal(
    firstGoalSideFromEvents(events, "Manchester City", "Chelsea"),
    "home"
  );
});

test("firstGoalSideFromEvents returns none for zero goals", () => {
  assert.equal(firstGoalSideFromEvents([], "A", "B"), "none");
});

test("matchNeedsApiDetailFill detects missing corners and goal timing", () => {
  const withCornersNoTiming: LogMatch = {
    id: "m1",
    homeTeam: "A",
    awayTeam: "B",
    predictions: {},
    actualResults: {},
    scored: {},
    teamStats: {
      home: { goals: 2, corners: 5 },
      away: { goals: 1, corners: 3 },
    },
  };
  assert.equal(matchNeedsGoalEvents(withCornersNoTiming), true);
  assert.equal(matchNeedsApiDetailFill(withCornersNoTiming), true);

  const complete: LogMatch = {
    ...withCornersNoTiming,
    teamStats: {
      ...withCornersNoTiming.teamStats!,
      firstGoalSide: "home",
      goalTiming: {
        goalInFirst10: false,
        timingBuckets: {
          g0_15: 0,
          g16_30: 1,
          g31_45: 0,
          g46_60: 0,
          g61_75: 0,
          g76_90plus: 0,
        },
      },
      lineups: {
        home: { starting: ["P1"], substitutes: [] },
        away: { starting: ["P2"], substitutes: [] },
      },
    },
  };
  assert.equal(matchNeedsApiDetailFill(complete), false);
});

test("mapFixtureToMatchUpdates merges events empty-field only", () => {
  const fixture: ApiFootballFixture = {
    fixture: { id: 99, date: "2026-03-15T15:00:00+00:00", status: { short: "FT" } },
    teams: { home: { name: "Manchester City" }, away: { name: "Chelsea" } },
    goals: { home: 2, away: 1 },
    score: { halftime: { home: 1, away: 0 } },
  };
  const stats: ApiFootballStatBlock[] = [
    {
      team: { name: "Manchester City" },
      statistics: [{ type: "Corner Kicks", value: 7 }],
    },
    {
      team: { name: "Chelsea" },
      statistics: [{ type: "Corner Kicks", value: 4 }],
    },
  ];
  const match: LogMatch = {
    id: "m1",
    homeTeam: "Man City",
    awayTeam: "Chelsea",
    predictions: {},
    actualResults: {},
    scored: {},
    teamStats: {
      home: { goals: 2, corners: 3 },
      away: { goals: 1 },
    },
  };
  const events: FixtureGoalEvent[] = [
    { minute: 5, team: "Manchester City", player: "Haaland", detail: null },
  ];
  const lineups = {
    home: { starting: ["Ederson"], substitutes: [] },
    away: { starting: ["James"], substitutes: [] },
  };
  const updates = mapFixtureToMatchUpdates(fixture, stats, match, {
    events,
    lineups,
  });
  assert.equal(updates.teamStats?.home?.corners, 3);
  assert.equal(updates.teamStats?.away?.corners, 4);
  assert.equal(updates.teamStats?.firstGoalSide, "home");
  assert.equal(updates.teamStats?.goalTiming?.goalInFirst10, true);
  assert.equal(updates.teamStats?.lineups?.home.starting[0], "Ederson");
});
