import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiFootballStatBlock } from "@/lib/football-api/map-fixture-to-match";
import {
  enrichmentFromApiStatistics,
  fixtureNeedsStatisticsHydration,
  hasCornerData,
} from "./hydrate-api-statistics";

const reversedStats: ApiFootballStatBlock[] = [
  {
    team: { name: "Chelsea" },
    statistics: [
      { type: "Total Shots", value: 9 },
      { type: "Shots on Goal", value: 3 },
      { type: "Corner Kicks", value: 4 },
      { type: "Ball Possession", value: "42%" },
    ],
  },
  {
    team: { name: "Manchester City" },
    statistics: [
      { type: "Total Shots", value: 14 },
      { type: "Shots on Goal", value: 6 },
      { type: "Corner Kicks", value: 7 },
      { type: "Ball Possession", value: "58%" },
    ],
  },
];

test("enrichmentFromApiStatistics maps corners and related stats by team name", () => {
  const enrich = enrichmentFromApiStatistics(
    reversedStats,
    "Manchester City",
    "Chelsea"
  );
  assert.ok(enrich);
  assert.equal(enrich!.homeCorners, 7);
  assert.equal(enrich!.awayCorners, 4);
  assert.equal(enrich!.homeShots, 14);
  assert.equal(enrich!.awayShots, 9);
  assert.equal(enrich!.homePossession, 58);
  assert.equal(enrich!.awayPossession, 42);
  assert.equal(enrich!.homeShotsOnTarget, 6);
  assert.equal(enrich!.awayShotsOnTarget, 3);
});

test("enrichmentFromApiStatistics returns null for empty blocks", () => {
  assert.equal(
    enrichmentFromApiStatistics([], "Home", "Away"),
    null
  );
});

test("hasCornerData requires both sides", () => {
  assert.equal(hasCornerData({ homeCorners: 3, awayCorners: 2 }), true);
  assert.equal(hasCornerData({ homeCorners: 3, awayCorners: null }), false);
  assert.equal(hasCornerData({ homeCorners: null, awayCorners: null }), false);
});

test("fixtureNeedsStatisticsHydration skips when corners already present", () => {
  assert.equal(
    fixtureNeedsStatisticsHydration(
      { homeCorners: 5, awayCorners: 3 },
      null
    ),
    false
  );
  assert.equal(
    fixtureNeedsStatisticsHydration(null, {
      homeCorners: 1,
      awayCorners: 2,
    }),
    false
  );
  assert.equal(
    fixtureNeedsStatisticsHydration(
      { homeCorners: null, awayCorners: null },
      null
    ),
    true
  );
});

test("fixtureNeedsStatisticsHydration skips partial corner data in DB", () => {
  assert.equal(
    fixtureNeedsStatisticsHydration({ homeCorners: 5, awayCorners: null }, null),
    true
  );
});

console.log("hydrate-api-statistics tests passed");
