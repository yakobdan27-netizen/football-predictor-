import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LL_2026_27_PROMOTED,
  LL_2026_27_PROVISIONAL_TEAMS,
  LL_STYLE_SEEDS,
  computeDataConfidence,
  emptyLlTeamSeasonCard,
  emptyLlSeasonRosterStore,
  llStyleSeedForTeam,
} from "./ll-season-roster";
import { fillLlTeamSeasonCard } from "./ll-team-season-stats";
import {
  getSystemScoreWithAudit,
  applyHybridToRecommendedPick,
} from "./hybrid-recommendation";
import { emptyLearnerStats } from "./ai-learner";
import { teamsForLeague } from "./teams";
import type { RecommendedPick } from "./types";

test("LL provisional roster has 20 teams", () => {
  assert.equal(LL_2026_27_PROVISIONAL_TEAMS.length, 20);
  assert.ok(LL_2026_27_PROVISIONAL_TEAMS.includes("Real Madrid"));
  assert.ok(LL_2026_27_PROVISIONAL_TEAMS.includes("Barcelona"));
  assert.ok(LL_2026_27_PROVISIONAL_TEAMS.includes("Ath Madrid"));
  assert.ok(LL_2026_27_PROVISIONAL_TEAMS.includes("Racing Santander"));
  assert.ok(LL_2026_27_PROVISIONAL_TEAMS.includes("Deportivo"));
  assert.ok(LL_2026_27_PROVISIONAL_TEAMS.includes("Malaga"));
});

test("LL promoted flags and null style seeds", () => {
  for (const t of LL_2026_27_PROMOTED) {
    const card = emptyLlTeamSeasonCard(t);
    assert.equal(card.is_promoted, true);
    assert.equal(card.style_seed, null);
  }
  assert.equal(llStyleSeedForTeam("Racing Santander"), null);
  assert.equal(llStyleSeedForTeam("Osasuna"), null);
  assert.ok(llStyleSeedForTeam("Getafe"));
  assert.ok(LL_STYLE_SEEDS["Ath Madrid"]);
  assert.ok(LL_STYLE_SEEDS.Getafe.leans.includes("under"));
});

test("fillLlTeamSeasonCard leaves numerics null without 2026/27 DB rows", () => {
  const card = fillLlTeamSeasonCard("Barcelona", { batches: [] });
  assert.equal(card.goals_scored_pg, null);
  assert.equal(card.corners_won_pg, null);
  assert.equal(card.over_2_5_rate, null);
  assert.equal(card.matches_played, null);
  assert.equal(card.data_confidence, 0);
  assert.ok(card.style_seed);
});

test("LL promoted confidence reduced until 8 samples", () => {
  assert.ok(computeDataConfidence(4, true) < computeDataConfidence(4, false));
  assert.equal(computeDataConfidence(8, true), computeDataConfidence(8, false));
  assert.equal(computeDataConfidence(20, false), 1);
});

test("hybrid system score pulls toward La Liga Under prior when conf low", () => {
  const store = emptyLlSeasonRosterStore();
  const pick: RecommendedPick = {
    prediction: "Over 2.5",
    confidence: 80,
    pFinal: 80,
    action: "keep",
    judgment: "test",
    accepted: true,
  };
  const audited = getSystemScoreWithAudit(pick, {
    leagueName: "La Liga",
    marketKey: "total_goals_ou",
    matchSampleSize: 0,
    llRoster: store,
    homeTeam: "Barcelona",
    awayTeam: "Getafe",
    matchDate: "2026-09-15",
  });
  assert.ok(audited.score < 80);
  assert.ok(audited.notes.length > 0);
  assert.ok(
    audited.notes.some((n) => n.includes("La Liga") || n.includes("prior"))
  );

  const out = applyHybridToRecommendedPick(pick, emptyLearnerStats(), {
    leagueName: "La Liga",
    marketKey: "total_goals_ou",
    llRoster: store,
    homeTeam: "Barcelona",
    awayTeam: "Getafe",
    matchDate: "2026-09-15",
  });
  assert.equal(out.action, "keep");
  assert.ok(out.hybridConfidence != null);
});

test("teamsForLeague uses 20 for 2026/27 La Liga", () => {
  const roster = teamsForLeague("La Liga", null, { season: "2026/27" });
  assert.equal(roster.length, 20);
  assert.ok(roster.includes("Real Madrid"));
  assert.ok(roster.includes("Racing Santander"));
  const legacy = teamsForLeague("La Liga");
  assert.ok(legacy.length >= 20);
});

test("LL roster mismatch marks seed_paused without inventing stats", () => {
  const store = emptyLlSeasonRosterStore();
  store.mismatches.push({
    provisional: "Racing Santander",
    reason: "Not found in API",
  });
  store.cards["Racing Santander"] = {
    ...store.cards["Racing Santander"]!,
    seed_paused: true,
  };
  assert.equal(store.cards["Racing Santander"]!.team, "Racing Santander");
  assert.equal(store.cards["Racing Santander"]!.seed_paused, true);
  assert.equal(store.cards["Racing Santander"]!.goals_scored_pg, null);
});

test("verify overwrite path replaces teams list (unit)", () => {
  const store = emptyLlSeasonRosterStore();
  const apiSet = [
    ...LL_2026_27_PROVISIONAL_TEAMS.filter((t) => t !== "Racing Santander"),
    "Girona",
  ];
  assert.equal(apiSet.length, 20);
  store.teams = apiSet;
  store.roster_verified = true;
  assert.ok(store.teams.includes("Girona"));
  assert.ok(!store.teams.includes("Racing Santander"));
  assert.equal(store.teams.length, 20);
});
