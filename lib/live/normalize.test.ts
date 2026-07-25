import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isFinishedStatus,
  normalizeEvents,
  normalizeFixture,
} from "./normalize";
import type { LiveApiFixture } from "./types";

function sample(overrides?: Partial<LiveApiFixture>): LiveApiFixture {
  return {
    fixture: {
      id: 1001,
      date: "2026-08-16T14:00:00+00:00",
      status: { short: "NS", elapsed: null },
      venue: { name: "Emirates" },
    },
    league: { id: 39, name: "Premier League", season: 2025, logo: null },
    teams: {
      home: { id: 42, name: "Arsenal" },
      away: { id: 49, name: "Chelsea" },
    },
    goals: { home: null, away: null },
    ...overrides,
  };
}

test("normalizeFixture keeps null goals and minute when missing", () => {
  const row = normalizeFixture(sample(), new Date("2026-07-25T12:00:00Z"));
  assert.ok(row);
  assert.equal(row!.homeGoals, null);
  assert.equal(row!.awayGoals, null);
  assert.equal(row!.statusMinute, null);
  assert.equal(row!.venue, "Emirates");
});

test("normalizeFixture clears minute on FT", () => {
  const row = normalizeFixture(
    sample({
      fixture: {
        id: 1001,
        date: "2026-08-16T14:00:00+00:00",
        status: { short: "FT", elapsed: 90 },
      },
      goals: { home: 2, away: 1 },
    }),
    new Date()
  );
  assert.ok(row);
  assert.equal(row!.statusMinute, null);
  assert.equal(row!.homeGoals, 2);
  assert.ok(isFinishedStatus(row!.status));
});

test("normalizeEvents maps nullable fields without inventing", () => {
  const events = normalizeEvents(9, [
    { time: { elapsed: 12 }, type: "Goal", team: { name: "Arsenal" }, player: {} },
  ]);
  assert.equal(events[0]!.minute, 12);
  assert.equal(events[0]!.player, null);
});
