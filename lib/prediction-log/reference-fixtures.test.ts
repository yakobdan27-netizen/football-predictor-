import assert from "node:assert/strict";
import {
  canonicalFixtureKey,
  mapCompetitionToLeague,
  parseReferenceDate,
  parseReferenceFixtureCsv,
  referenceRowsToMatchRows,
} from "./reference-fixtures";

const formatA = `Competition,Date,Matchday,HomeTeam,AwayTeam,HomeScore,AwayScore,Result
Premier League,2025-09-21,5,Arsenal,Manchester City,1,1,Draw
Champions League,2025-09-18,1,Manchester City,Napoli,2,0,Win
La Liga,2025-08-19,1,Real Madrid,Osasuna,1,0,W
EFL Cup,2026-02-26,SF2,Manchester City,Newcastle United,Pending,Pending,Pending
`;

const rowsA = parseReferenceFixtureCsv(formatA);
assert.equal(rowsA.length, 3);
assert.equal(rowsA[0]!.homeTeam, "Arsenal");
assert.equal(rowsA[0]!.awayTeam, "Man City");
assert.equal(rowsA[2]!.homeTeam, "Real Madrid");
assert.equal(mapCompetitionToLeague("Champions League"), "UEFA Champions League");
assert.equal(mapCompetitionToLeague("La Liga"), "La Liga");
assert.equal(mapCompetitionToLeague("Unknown Cup", "Ligue 1"), "Ligue 1");

const formatB = `Date,Competition,Home,Away,Result,Score
17-Aug-25,La Liga,Espanyol,Atletico Madrid,Away,2-1
13-Aug-25,Supercopa de España,Barcelona,Real Madrid,Home,2-2 pens
13-Aug-25,Supercopa de España,Real Madrid,Barcelona,Away,2-2 pens
04-Aug-25,Friendly,Liverpool,Athletic Bilbao,Home,4-1
04-Aug-25,Friendly,Liverpool,Athletic Bilbao,Home,2-3
`;

const rowsB = parseReferenceFixtureCsv(formatB);
assert.equal(rowsB.length, 4, "dedup reversed supercopa, keep two friendlies");
assert.equal(rowsB[0]!.awayTeam, "Ath Madrid");
assert.equal(rowsB[0]!.date, "2025-08-17");
assert.equal(parseReferenceDate("17-Aug-25"), "2025-08-17");

const pensRow = rowsB.find((r) => r.competition.includes("Supercopa"));
assert.ok(pensRow);
assert.equal(pensRow!.homeScore, 2);
assert.equal(pensRow!.awayScore, 2);

const matchRows = referenceRowsToMatchRows(rowsA);
assert.equal(matchRows[0]!.FTHG, 1);
assert.equal(matchRows[0]!.FTAG, 1);

const key1 = canonicalFixtureKey({
  competition: "La Liga",
  date: "2025-10-26",
  matchday: "",
  homeTeam: "Real Madrid",
  awayTeam: "Barcelona",
  homeScore: 2,
  awayScore: 1,
});
const key2 = canonicalFixtureKey({
  competition: "La Liga",
  date: "2025-10-26",
  matchday: "",
  homeTeam: "Barcelona",
  awayTeam: "Real Madrid",
  homeScore: 1,
  awayScore: 2,
});
assert.equal(key1, key2, "canonical key ignores home/away orientation");

console.log("reference-fixtures tests passed");
