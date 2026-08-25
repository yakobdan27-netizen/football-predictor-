/**
 * Run: npx tsx lib/match-centre/team-half-rates.test.ts
 */
import assert from "node:assert/strict";
import {
  aggregateTeamHalfRatesFromFixtures,
  aggregateTeamHalfRatesFromLastNFixtures,
  type MatchCentreFixtureHalfRow,
} from "./team-half-rates";

function fixture(
  id: number,
  home: string,
  away: string,
  kickoff: string,
  hg: number,
  ag: number,
  h1: number,
  a1: number
): MatchCentreFixtureHalfRow {
  return {
    fixtureId: id,
    leagueId: 39,
    leagueName: "Premier League",
    homeTeam: home,
    awayTeam: away,
    kickoffUtc: kickoff,
    homeGoals: hg,
    awayGoals: ag,
    homeGoals1h: h1,
    awayGoals1h: a1,
  };
}

{
  const all = [
    fixture(1, "Arsenal", "Everton", "2026-08-10T12:00:00Z", 2, 0, 1, 0),
    fixture(2, "Chelsea", "Arsenal", "2026-08-17T12:00:00Z", 1, 1, 0, 1),
    fixture(3, "Arsenal", "Fulham", "2026-08-24T12:00:00Z", 3, 1, 2, 0),
    fixture(4, "Liverpool", "Arsenal", "2026-08-31T12:00:00Z", 0, 2, 0, 1),
    fixture(5, "Arsenal", "Wolves", "2026-09-07T12:00:00Z", 1, 0, 1, 0),
    fixture(6, "Brighton", "Arsenal", "2026-09-14T12:00:00Z", 2, 2, 1, 1),
    fixture(7, "Arsenal", "Tottenham", "2026-09-21T12:00:00Z", 4, 2, 2, 1),
  ];

  const full = aggregateTeamHalfRatesFromFixtures(all, "Arsenal", "Premier League");
  const last5 = aggregateTeamHalfRatesFromLastNFixtures(
    all,
    "Arsenal",
    "Premier League",
    5
  );

  assert.equal(full.n, 7);
  assert.equal(last5.n, 5, "last-5 cap excludes oldest two Arsenal fixtures");
  assert.notEqual(last5.af1, full.af1, "last-5 window should differ from full season");
}

console.log("team-half-rates tests passed");
