import assert from "node:assert/strict";
import { test } from "node:test";
import type { UpcomingFixtureRow } from "@/lib/football-api/fetch-upcoming-league";
import {
  filterWeekendFixtures,
  selectWeekendPickCount,
  WEEKEND_PICK_MAX,
  WEEKEND_PICK_MIN,
} from "./weekend-opportunities";

function row(
  id: number,
  kickoffIso: string,
  status = "NS"
): UpcomingFixtureRow {
  return {
    apiFixtureId: id,
    kickoffIso,
    matchDate: kickoffIso.slice(0, 10),
    status,
    home: { id: 1, name: "Home FC" },
    away: { id: 2, name: "Away FC" },
    venue: null,
    league: "Premier League",
    leagueId: 39,
  };
}

test("filterWeekendFixtures keeps Sat/Sun within 7 days", () => {
  const now = new Date("2026-08-17T12:00:00.000Z"); // Monday
  const sat = row(1, "2026-08-22T15:00:00.000Z");
  const sun = row(2, "2026-08-23T15:00:00.000Z");
  const mon = row(3, "2026-08-24T15:00:00.000Z");
  const tooFar = row(4, "2026-08-30T15:00:00.000Z");

  const out = filterWeekendFixtures([sat, sun, mon, tooFar], { now });
  assert.equal(out.length, 2);
  assert.ok(out.some((f) => f.apiFixtureId === 1));
  assert.ok(out.some((f) => f.apiFixtureId === 2));
});

test("filterWeekendFixtures excludes non-NS/TBD", () => {
  const now = new Date("2026-08-17T12:00:00.000Z");
  const live = row(1, "2026-08-22T15:00:00.000Z", "1H");
  const out = filterWeekendFixtures([live], { now });
  assert.equal(out.length, 0);
});

test("selectWeekendPickCount caps at 20 and floors at 10 when pool large enough", () => {
  assert.deepEqual(selectWeekendPickCount(25), {
    count: WEEKEND_PICK_MAX,
    insufficientPool: false,
  });
  assert.deepEqual(selectWeekendPickCount(15), {
    count: 15,
    insufficientPool: false,
  });
  assert.deepEqual(selectWeekendPickCount(10), {
    count: WEEKEND_PICK_MIN,
    insufficientPool: false,
  });
});

test("selectWeekendPickCount returns all when pool below minimum", () => {
  assert.deepEqual(selectWeekendPickCount(8), {
    count: 8,
    insufficientPool: true,
  });
  assert.deepEqual(selectWeekendPickCount(0), {
    count: 0,
    insufficientPool: false,
  });
});
