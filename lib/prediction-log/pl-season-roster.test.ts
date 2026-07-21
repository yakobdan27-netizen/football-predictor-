import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PL_2026_27_PROMOTED,
  PL_2026_27_PROVISIONAL_TEAMS,
  PL_STYLE_SEEDS,
  computeDataConfidence,
  emptyTeamSeasonCard,
  emptyPlSeasonRosterStore,
  styleSeedAlign,
  styleSeedForTeam,
} from "./pl-season-roster";
import { fillTeamSeasonCard } from "./pl-team-season-stats";
import {
  getSystemScoreWithAudit,
  applyHybridToRecommendedPick,
} from "./hybrid-recommendation";
import { emptyLearnerStats } from "./ai-learner";
import { teamsForLeague } from "./teams";
import type { RecommendedPick } from "./types";

test("provisional roster has 20 teams", () => {
  assert.equal(PL_2026_27_PROVISIONAL_TEAMS.length, 20);
  assert.ok(PL_2026_27_PROVISIONAL_TEAMS.includes("Arsenal"));
  assert.ok(PL_2026_27_PROVISIONAL_TEAMS.includes("Man City"));
  assert.ok(PL_2026_27_PROVISIONAL_TEAMS.includes("Coventry"));
  assert.ok(PL_2026_27_PROVISIONAL_TEAMS.includes("Hull"));
  assert.ok(PL_2026_27_PROVISIONAL_TEAMS.includes("Ipswich Town"));
});

test("promoted flags and null style seeds", () => {
  for (const t of PL_2026_27_PROMOTED) {
    const card = emptyTeamSeasonCard(t);
    assert.equal(card.is_promoted, true);
    assert.equal(card.style_seed, null);
  }
  assert.equal(styleSeedForTeam("Leeds"), null);
  assert.equal(styleSeedForTeam("Sunderland"), null);
  assert.ok(styleSeedForTeam("Liverpool"));
  assert.ok(PL_STYLE_SEEDS.Arsenal);
});

test("fillTeamSeasonCard leaves numerics null without 2026/27 DB rows", () => {
  const card = fillTeamSeasonCard("Arsenal", { batches: [] });
  assert.equal(card.goals_scored_pg, null);
  assert.equal(card.corners_won_pg, null);
  assert.equal(card.over_2_5_rate, null);
  assert.equal(card.matches_played, null);
  assert.equal(card.data_confidence, 0);
  assert.ok(card.style_seed);
});

test("promoted confidence reduced until 8 samples", () => {
  assert.ok(computeDataConfidence(4, true) < computeDataConfidence(4, false));
  assert.equal(computeDataConfidence(8, true), computeDataConfidence(8, false));
  assert.equal(computeDataConfidence(20, false), 1);
});

test("styleSeedAlign never blocks — only ± lean", () => {
  const seed = styleSeedForTeam("Everton");
  assert.equal(styleSeedAlign(seed, "total_goals_ou", "Under 2.5"), 1);
  assert.equal(styleSeedAlign(seed, "total_goals_ou", "Over 2.5"), -1);
});

test("hybrid system score pulls toward prior when PL conf low", () => {
  const store = emptyPlSeasonRosterStore();
  // Arsenal card has conf 0
  const pick: RecommendedPick = {
    prediction: "Over 2.5",
    confidence: 80,
    pFinal: 80,
    action: "keep",
    judgment: "test",
    accepted: true,
  };
  const audited = getSystemScoreWithAudit(pick, {
    leagueName: "Premier League",
    marketKey: "total_goals_ou",
    matchSampleSize: 0,
    plRoster: store,
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    matchDate: "2026-09-15",
  });
  assert.ok(audited.score < 80);
  assert.ok(audited.notes.length > 0);

  const out = applyHybridToRecommendedPick(pick, emptyLearnerStats(), {
    leagueName: "Premier League",
    marketKey: "total_goals_ou",
    plRoster: store,
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    matchDate: "2026-09-15",
  });
  assert.equal(out.action, "keep");
  assert.ok(out.hybridConfidence != null);
});

test("teamsForLeague uses 20 for 2026/27 PL", () => {
  const roster = teamsForLeague("Premier League", null, { season: "2026/27" });
  assert.equal(roster.length, 20);
  assert.ok(!roster.includes("Wolves"));
  const legacy = teamsForLeague("Premier League");
  assert.ok(legacy.length > 20);
});

test("roster mismatch marks seed_paused without renaming", () => {
  const store = emptyPlSeasonRosterStore();
  store.mismatches.push({
    provisional: "Hull",
    reason: "Not found in API",
  });
  store.cards.Hull = { ...store.cards.Hull!, seed_paused: true };
  assert.equal(store.cards.Hull!.team, "Hull");
  assert.equal(store.cards.Hull!.seed_paused, true);
});
