/**
 * Run: npx tsx lib/system-season/ingest-from-api.test.ts
 */
import assert from "node:assert/strict";
import type { LiveApiFixture } from "@/lib/live/types";
import { mapSystemSeasonFixture } from "./map-api";

{
  const raw = {
    fixture: {
      id: 999001,
      date: "2026-09-15T14:00:00+00:00",
      status: { short: "FT" },
      venue: { name: "Test Arena" },
    },
    league: { id: 39, season: 2026 },
    teams: {
      home: { id: 33, name: "Manchester United" },
      away: { id: 34, name: "Newcastle" },
    },
    goals: { home: 2, away: 1 },
    score: {
      halftime: { home: 1, away: 0 },
      fulltime: { home: 2, away: 1 },
    },
  } as LiveApiFixture;

  const row = mapSystemSeasonFixture(raw, 2026, "core-only");
  assert.ok(row);
  assert.equal(row!.fixtureId, 999001);
  assert.equal(row!.leagueId, 39);
  assert.equal(row!.season, 2026);
  assert.equal(row!.ftHome, 2);
  assert.equal(row!.ftAway, 1);
  assert.equal(row!.htHome, 1);
  assert.equal(row!.htAway, 0);
  assert.equal(row!.status, "FT");
  assert.equal(row!.homeTeam, "Manchester United");
}

console.log("ingest-from-api tests passed");
