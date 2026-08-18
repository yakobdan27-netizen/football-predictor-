import assert from "node:assert/strict";
import { test } from "node:test";
import type { UpcomingFixtureRow } from "@/lib/football-api/fetch-upcoming-league";
import {
  filterWeekendFixtures,
  selectWeekendPickCount,
  weekendComboSelectionAllowed,
  weekendTotalsSelectionAllowed,
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

test("weekendTotalsSelectionAllowed excludes trivial total goals lines", () => {
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "over_0_5", 0.5), false);
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "over_1_5", 1.5), true);
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "over_2_5", 2.5), true);
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "under_6_5", 6.5), false);
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "under_5_5", 5.5), false);
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "under_4_5", 4.5), true);
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "under_0_5", 0.5), true);
});

test("weekendTotalsSelectionAllowed passes through non-TOTALS families", () => {
  assert.equal(weekendTotalsSelectionAllowed("BTTS", "yes", undefined), true);
  assert.equal(weekendTotalsSelectionAllowed("RESULT_1X2", "home"), true);
});

test("weekendComboSelectionAllowed restricts combo pool for Weekend Picks", () => {
  assert.equal(
    weekendComboSelectionAllowed("COMBO", "1x_over_1_5"),
    false
  );
  assert.equal(
    weekendComboSelectionAllowed("COMBO", "1x_btts_yes"),
    true
  );
  assert.equal(
    weekendComboSelectionAllowed("COMBO", "btts_yes_over_2_5"),
    true
  );
  assert.equal(
    weekendComboSelectionAllowed("COMBO", "home_over_1_5"),
    true
  );
  assert.equal(
    weekendComboSelectionAllowed("COMBO", "home_btts_yes"),
    false
  );
  assert.equal(weekendComboSelectionAllowed("BTTS", "yes"), true);
});
