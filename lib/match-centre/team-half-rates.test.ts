import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateTeamHalfRatesFromFixtures,
  halfGoalsFromEvents,
  type MatchCentreFixtureHalfRow,
} from "./team-half-rates";

test("halfGoalsFromEvents counts first-half goals only", () => {
  const events = [
    { minute: 12, type: "Goal", team: "Arsenal" },
    { minute: 44, type: "Goal", team: "Chelsea" },
    { minute: 67, type: "Goal", team: "Arsenal" },
  ];
  const ht = halfGoalsFromEvents(events, "Arsenal", "Chelsea");
  assert.equal(ht.homeGoals1h, 1);
  assert.equal(ht.awayGoals1h, 1);
});

test("halfGoalsFromEvents returns null when no first-half goals", () => {
  const events = [{ minute: 55, type: "Goal", team: "Arsenal" }];
  const ht = halfGoalsFromEvents(events, "Arsenal", "Chelsea");
  assert.equal(ht.homeGoals1h, null);
  assert.equal(ht.awayGoals1h, null);
});

test("aggregateTeamHalfRatesFromFixtures computes home team half rates", () => {
  const fixtures: MatchCentreFixtureHalfRow[] = [
    {
      fixtureId: 1,
      leagueId: 39,
      leagueName: "Premier League",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      homeGoals: 3,
      awayGoals: 1,
      homeGoals1h: 2,
      awayGoals1h: 0,
    },
    {
      fixtureId: 2,
      leagueId: 39,
      leagueName: "Premier League",
      homeTeam: "Arsenal",
      awayTeam: "Liverpool",
      homeGoals: 2,
      awayGoals: 2,
      homeGoals1h: 1,
      awayGoals1h: 1,
    },
  ];

  const rates = aggregateTeamHalfRatesFromFixtures(
    fixtures,
    "Arsenal",
    "Premier League"
  );
  assert.equal(rates.n, 2);
  // Match 1 home: sc1=2 sc2=1 conc1=0 conc2=1; Match 2 home: sc1=1 sc2=1 conc1=1 conc2=1
  assert.equal(rates.af1, (2 + 1) / 2);
  assert.equal(rates.af2, (1 + 1) / 2);
  assert.equal(rates.da1, (0 + 1) / 2);
  assert.equal(rates.da2, (1 + 1) / 2);
});

test("aggregateTeamHalfRatesFromFixtures skips fixtures without HT", () => {
  const fixtures: MatchCentreFixtureHalfRow[] = [
    {
      fixtureId: 1,
      leagueId: 39,
      leagueName: "Premier League",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      homeGoals: 2,
      awayGoals: 0,
      homeGoals1h: null,
      awayGoals1h: null,
    },
  ];
  const rates = aggregateTeamHalfRatesFromFixtures(
    fixtures,
    "Arsenal",
    "Premier League"
  );
  assert.equal(rates.n, 0);
});

test("aggregateTeamHalfRatesFromFixtures filters by league", () => {
  const fixtures: MatchCentreFixtureHalfRow[] = [
    {
      fixtureId: 1,
      leagueId: 140,
      leagueName: "La Liga",
      homeTeam: "Barcelona",
      awayTeam: "Real Madrid",
      homeGoals: 1,
      awayGoals: 0,
      homeGoals1h: 1,
      awayGoals1h: 0,
    },
  ];
  const rates = aggregateTeamHalfRatesFromFixtures(
    fixtures,
    "Barcelona",
    "Premier League"
  );
  assert.equal(rates.n, 0);
});
