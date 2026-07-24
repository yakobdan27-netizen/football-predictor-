import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SA_2026_27_PROMOTED,
  SA_2026_27_PROVISIONAL_TEAMS,
  SA_STYLE_SEEDS,
  computeDataConfidence,
  emptySaTeamSeasonCard,
  emptySaSeasonRosterStore,
  saStyleSeedForTeam,
} from "./sa-season-roster";
import { fillSaTeamSeasonCard } from "./sa-team-season-stats";
import { teamsForLeague } from "./teams";

test("SA provisional roster has 20 teams including promoted trio", () => {
  assert.equal(SA_2026_27_PROVISIONAL_TEAMS.length, 20);
  assert.ok(SA_2026_27_PROVISIONAL_TEAMS.includes("Inter"));
  assert.ok(SA_2026_27_PROVISIONAL_TEAMS.includes("Venezia"));
  assert.ok(SA_2026_27_PROVISIONAL_TEAMS.includes("Frosinone"));
  assert.ok(SA_2026_27_PROVISIONAL_TEAMS.includes("Monza"));
  assert.ok(!SA_2026_27_PROVISIONAL_TEAMS.includes("Cremonese"));
  assert.ok(!SA_2026_27_PROVISIONAL_TEAMS.includes("Pisa"));
  assert.ok(!SA_2026_27_PROVISIONAL_TEAMS.includes("Verona"));
});

test("SA promoted flags and qualitative seeds", () => {
  for (const t of SA_2026_27_PROMOTED) {
    const card = emptySaTeamSeasonCard(t);
    assert.equal(card.is_promoted, true);
    assert.ok(card.style_seed);
  }
  assert.ok(saStyleSeedForTeam("Venezia"));
  assert.ok(SA_STYLE_SEEDS.Monza);
  assert.equal(emptySaSeasonRosterStore().roster_verified, false);
});

test("fillSaTeamSeasonCard leaves numerics null without 2026/27 DB rows", () => {
  const card = fillSaTeamSeasonCard("Inter", { batches: [] });
  assert.equal(card.goals_scored_pg, null);
  assert.equal(card.corners_won_pg, null);
  assert.equal(card.over_2_5_rate, null);
  assert.equal(card.matches_played, null);
  assert.equal(card.data_confidence, 0);
  assert.ok(card.style_seed);
});

test("SA promoted confidence reduced until 8 samples", () => {
  assert.ok(computeDataConfidence(4, true) < computeDataConfidence(4, false));
  assert.equal(computeDataConfidence(8, true), computeDataConfidence(8, false));
});

test("teamsForLeague uses 20 for 2026/27 Serie A", () => {
  const roster = teamsForLeague("Serie A", null, { season: "2026/27" });
  assert.equal(roster.length, 20);
  assert.ok(roster.includes("Frosinone"));
  const legacy = teamsForLeague("Serie A");
  assert.ok(legacy.length >= 20);
});
