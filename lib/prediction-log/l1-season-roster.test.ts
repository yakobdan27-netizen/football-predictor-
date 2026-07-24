import assert from "node:assert/strict";
import { test } from "node:test";
import {
  L1_2026_27_PROMOTED_HINTS,
  L1_EXPECTED_TEAM_COUNT,
  L1_STYLE_SEEDS,
  computeDataConfidence,
  emptyL1SeasonRosterStore,
  emptyL1TeamSeasonCard,
  isL1PromotedTeam,
  l1StyleSeedForTeam,
} from "./l1-season-roster";
import { fillL1TeamSeasonCard, buildAllL1SeasonCards } from "./l1-team-season-stats";
import { teamsForLeague } from "./teams";
import { NEXT_MATCHES_LEAGUES } from "@/lib/football-api/fetch-upcoming-league";

test("NEXT_MATCHES includes Ligue 1", () => {
  assert.ok((NEXT_MATCHES_LEAGUES as readonly string[]).includes("Ligue 1"));
});

test("L1 store starts empty until verify", () => {
  const store = emptyL1SeasonRosterStore();
  assert.equal(store.teams.length, 0);
  assert.equal(store.roster_verified, false);
  assert.deepEqual(store.promoted, L1_2026_27_PROMOTED_HINTS);
  assert.ok(L1_2026_27_PROMOTED_HINTS.includes("Troyes"));
  assert.ok(L1_2026_27_PROMOTED_HINTS.includes("Le Mans"));
});

test("L1 style seeds — Troyes yes, Le Mans null", () => {
  assert.ok(l1StyleSeedForTeam("Troyes"));
  assert.equal(l1StyleSeedForTeam("Le Mans"), null);
  assert.ok(L1_STYLE_SEEDS["Paris SG"]);
  const leMans = emptyL1TeamSeasonCard("Le Mans");
  assert.equal(leMans.is_promoted, true);
  assert.equal(leMans.style_seed, null);
});

test("fillL1TeamSeasonCard leaves numerics null without 2026/27 DB rows", () => {
  const card = fillL1TeamSeasonCard("Paris SG", { batches: [] });
  assert.equal(card.goals_scored_pg, null);
  assert.equal(card.matches_played, null);
  assert.equal(card.data_confidence, 0);
});

test("L1 third promoted discovered via isL1PromotedTeam (not hard-coded)", () => {
  const roster = [
    "Paris SG",
    "Marseille",
    "Troyes",
    "Le Mans",
    "Lorient",
    ...Array.from({ length: 13 }, (_, i) => `Club${i}`),
  ];
  assert.equal(roster.length, 18);
  assert.equal(isL1PromotedTeam("Troyes", roster), true);
  assert.equal(isL1PromotedTeam("Le Mans", roster), true);
  assert.equal(isL1PromotedTeam("Lorient", roster), true);
  assert.equal(isL1PromotedTeam("Paris SG", roster), false);
});

test("teamsForLeague L1 2026/27 uses store only (empty fallback)", () => {
  const empty = teamsForLeague("Ligue 1", null, { season: "2026/27" });
  assert.equal(empty.length, 0);

  const store = emptyL1SeasonRosterStore();
  store.teams = Array.from({ length: L1_EXPECTED_TEAM_COUNT }, (_, i) => `Club${i}`);
  store.cards = buildAllL1SeasonCards([], undefined, store.teams);
  const roster = teamsForLeague("Ligue 1", null, {
    season: "2026/27",
    l1Roster: store,
  });
  assert.equal(roster.length, L1_EXPECTED_TEAM_COUNT);
});

test("L1 promoted confidence reduced until 8 samples", () => {
  assert.ok(computeDataConfidence(3, true) < computeDataConfidence(3, false));
});
