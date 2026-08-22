/**
 * Run: npx tsx lib/system-season/team-rates.test.ts
 */
import assert from "node:assert/strict";
import type { SystemSeasonFixture } from "@/lib/db/schema";
import { aggregateTeamRatesFromFixtures } from "./team-rates";

function mkFixture(partial: Partial<SystemSeasonFixture> & Pick<SystemSeasonFixture, "fixtureId">): SystemSeasonFixture {
  return {
    fixtureId: partial.fixtureId,
    leagueId: partial.leagueId ?? 39,
    season: partial.season ?? 2026,
    dateUtc: partial.dateUtc ?? new Date("2026-09-01T15:00:00Z"),
    homeId: partial.homeId ?? 1,
    awayId: partial.awayId ?? 2,
    homeTeam: partial.homeTeam ?? "Home FC",
    awayTeam: partial.awayTeam ?? "Away FC",
    venue: partial.venue ?? null,
    htHome: "htHome" in partial ? partial.htHome! : 1,
    htAway: "htAway" in partial ? partial.htAway! : 0,
    ftHome: partial.ftHome ?? 2,
    ftAway: partial.ftAway ?? 1,
    status: partial.status ?? "FT",
    dataCompleteness: partial.dataCompleteness ?? "core-only",
    locked: partial.locked ?? 0,
    syncedAt: partial.syncedAt ?? new Date(),
  };
}

{
  const fixtures = [
    mkFixture({
      fixtureId: 1,
      homeId: 10,
      awayId: 20,
      homeTeam: "Alpha",
      awayTeam: "Beta",
      htHome: 1,
      htAway: 0,
      ftHome: 2,
      ftAway: 1,
    }),
    mkFixture({
      fixtureId: 2,
      homeId: 20,
      awayId: 10,
      homeTeam: "Beta",
      awayTeam: "Alpha",
      htHome: 0,
      htAway: 1,
      ftHome: 1,
      ftAway: 2,
    }),
  ];

  const rows = aggregateTeamRatesFromFixtures(fixtures, 39, 2026);
  const alpha = rows.find((r) => r.teamId === 10);
  const beta = rows.find((r) => r.teamId === 20);

  assert.ok(alpha, "alpha row");
  assert.ok(beta, "beta row");
  assert.equal(alpha!.nMatches, 2);
  assert.equal(beta!.nMatches, 2);
  // Alpha conceded 0 in 1H both matches; 1 in 2H both matches
  assert.equal(alpha!.da1, 0);
  assert.equal(alpha!.da2, 1);
}

{
  const rows = aggregateTeamRatesFromFixtures(
    [
      mkFixture({
        fixtureId: 3,
        homeId: 5,
        awayId: 6,
        htHome: null,
        htAway: null,
        ftHome: 1,
        ftAway: 0,
      }),
    ],
    39,
    2026
  );
  assert.equal(rows.length, 0, "fixtures without HT excluded from rate agg");
}

console.log("team-rates tests passed");
