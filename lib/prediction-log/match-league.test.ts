import assert from "node:assert/strict";
import {
  batchLeagueDisplay,
  deriveBatchLeague,
  matchLeague,
  normalizeMatchLeagues,
} from "./match-league";
import type { LogMatch } from "./types";

function match(league?: string): LogMatch {
  return {
    id: "m1",
    homeTeam: "A",
    awayTeam: "B",
    league,
    predictions: {},
    actualResults: {},
    scored: {},
  };
}

assert.equal(matchLeague(match("La Liga"), "Premier League"), "La Liga");
assert.equal(matchLeague(match(), "Premier League"), "Premier League");
assert.equal(deriveBatchLeague([match("Premier League"), match("Premier League")]), "Premier League");
assert.equal(deriveBatchLeague([match("Premier League"), match("La Liga")]), "Mixed");

const normalized = normalizeMatchLeagues([match()], "Serie A");
assert.equal(normalized[0]!.league, "Serie A");

const mixedBatch = {
  id: "b1",
  date: "2026-03-15",
  league: "Mixed",
  batchName: "Test",
  createdAt: new Date().toISOString(),
  batchKind: "manual" as const,
  matches: [match("Premier League"), match("La Liga")],
};
assert.equal(batchLeagueDisplay(mixedBatch), "Premier League + La Liga");

console.log("match-league tests passed");
