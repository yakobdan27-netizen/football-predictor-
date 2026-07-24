import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BL_2026_27_PROMOTED_HINTS,
  BL_2026_27_RECONCILE,
  BL_EXPECTED_TEAM_COUNT,
  BL_STYLE_SEEDS,
  blReconcileMismatches,
  computeDataConfidence,
  emptyBlSeasonRosterStore,
  emptyBlTeamSeasonCard,
  blStyleSeedForTeam,
  isBlPromotedTeam,
} from "./bl-season-roster";
import { fillBlTeamSeasonCard, buildAllBlSeasonCards } from "./bl-team-season-stats";
import {
  getSystemScoreWithAudit,
  applyHybridToRecommendedPick,
} from "./hybrid-recommendation";
import { emptyLearnerStats } from "./ai-learner";
import { RESEARCH_LEAGUE_PRIOR_SEEDS } from "./league-priors";
import { teamsForLeague } from "./teams";
import type { RecommendedPick } from "./types";

test("Bundesliga research prior seed is Over/BTTS-leaning", () => {
  const seed = RESEARCH_LEAGUE_PRIOR_SEEDS.bundesliga;
  assert.ok(seed);
  assert.equal(seed.leagueName, "Bundesliga");
  assert.ok((seed.over25_rate ?? 0) >= 62);
  assert.ok((seed.btts_rate ?? 0) >= 58);
  assert.equal(seed.avg_total_corners, 10.6);
});

test("BL store starts empty until verify (no hardcoded 18)", () => {
  const store = emptyBlSeasonRosterStore();
  assert.equal(store.teams.length, 0);
  assert.equal(store.roster_verified, false);
  assert.deepEqual(store.promoted, BL_2026_27_PROMOTED_HINTS);
  assert.ok(BL_2026_27_PROMOTED_HINTS.includes("Paderborn"));
  assert.equal(store.relegated_out.length, 0);
});

test("BL promoted hints have null style seeds", () => {
  for (const t of BL_2026_27_PROMOTED_HINTS) {
    const card = emptyBlTeamSeasonCard(t);
    assert.equal(card.is_promoted, true);
    assert.equal(card.style_seed, null);
    assert.equal(blStyleSeedForTeam(t), null);
  }
  assert.ok(BL_STYLE_SEEDS["Bayern Munich"]);
  assert.ok(BL_STYLE_SEEDS.Wolfsburg);
  assert.ok(BL_STYLE_SEEDS.Augsburg.leans.includes("under"));
});

test("BL RECONCILE mismatches for Wolfsburg/Heidenheim", () => {
  assert.ok(BL_2026_27_RECONCILE.includes("Wolfsburg"));
  assert.ok(BL_2026_27_RECONCILE.includes("Heidenheim"));
  const withBoth = blReconcileMismatches([
    "Bayern Munich",
    "Wolfsburg",
    "Heidenheim",
    "Paderborn",
  ]);
  assert.ok(withBoth.every((m) => m.reason.startsWith("RECONCILE:")));
  const missingWolf = blReconcileMismatches(["Bayern Munich", "Heidenheim", "Paderborn"]);
  assert.ok(
    missingWolf.some(
      (m) => m.provisional === "Wolfsburg" && m.reason.includes("missing from API")
    )
  );
});

test("fillBlTeamSeasonCard leaves numerics null without 2026/27 DB rows", () => {
  const card = fillBlTeamSeasonCard("Bayern Munich", { batches: [] });
  assert.equal(card.goals_scored_pg, null);
  assert.equal(card.corners_won_pg, null);
  assert.equal(card.over_2_5_rate, null);
  assert.equal(card.matches_played, null);
  assert.equal(card.data_confidence, 0);
  assert.ok(card.style_seed);
});

test("BL promoted confidence reduced until 8 samples", () => {
  assert.ok(computeDataConfidence(4, true) < computeDataConfidence(4, false));
  assert.equal(computeDataConfidence(8, true), computeDataConfidence(8, false));
});

test("hybrid system score pulls toward Bundesliga Over prior when conf low", () => {
  const store = emptyBlSeasonRosterStore();
  store.teams = ["Bayern Munich", "Augsburg"];
  store.cards = buildAllBlSeasonCards([], undefined, store.teams);

  const pick: RecommendedPick = {
    prediction: "Under 2.5",
    confidence: 80,
    pFinal: 80,
    action: "keep",
    judgment: "test",
    accepted: true,
  };
  const audited = getSystemScoreWithAudit(pick, {
    leagueName: "Bundesliga",
    marketKey: "total_goals_ou",
    matchSampleSize: 0,
    blRoster: store,
    homeTeam: "Bayern Munich",
    awayTeam: "Augsburg",
    matchDate: "2026-09-15",
  });
  assert.ok(audited.score < 80);
  assert.ok(audited.notes.length > 0);

  const out = applyHybridToRecommendedPick(pick, emptyLearnerStats(), {
    leagueName: "Bundesliga",
    marketKey: "total_goals_ou",
    blRoster: store,
    homeTeam: "Bayern Munich",
    awayTeam: "Augsburg",
    matchDate: "2026-09-15",
  });
  assert.equal(out.action, "keep");
  assert.ok(out.hybridConfidence != null);
});

test("teamsForLeague BL 2026/27 uses store only (empty fallback)", () => {
  const empty = teamsForLeague("Bundesliga", null, { season: "2026/27" });
  assert.equal(empty.length, 0);

  const store = emptyBlSeasonRosterStore();
  store.teams = Array.from({ length: BL_EXPECTED_TEAM_COUNT }, (_, i) => `Club${i}`);
  const roster = teamsForLeague("Bundesliga", null, {
    season: "2026/27",
    blRoster: store,
  });
  assert.equal(roster.length, BL_EXPECTED_TEAM_COUNT);

  const legacy = teamsForLeague("Bundesliga");
  assert.ok(legacy.length >= 18);
});

test("verify overwrite sets 18 teams with Paderborn promoted (unit)", () => {
  const store = emptyBlSeasonRosterStore();
  const eighteen = [
    "Bayern Munich",
    "Dortmund",
    "RB Leipzig",
    "Leverkusen",
    "Ein Frankfurt",
    "M'gladbach",
    "Stuttgart",
    "Freiburg",
    "Hoffenheim",
    "Werder Bremen",
    "Augsburg",
    "Heidenheim",
    "Union Berlin",
    "Mainz",
    "Paderborn",
    "Wolfsburg",
    "St Pauli",
    "FC Koln",
  ];
  assert.equal(eighteen.length, 18);
  store.teams = eighteen;
  store.roster_verified = true;
  store.cards = buildAllBlSeasonCards([], undefined, eighteen);
  store.promoted = eighteen.filter((t) => isBlPromotedTeam(t, eighteen));
  store.mismatches = blReconcileMismatches(eighteen);

  assert.equal(store.teams.length, 18);
  assert.ok(store.promoted.includes("Paderborn"));
  assert.ok(store.teams.includes("Wolfsburg"));
  assert.equal(store.cards.Paderborn!.style_seed, null);
  assert.equal(store.cards.Paderborn!.is_promoted, true);
  assert.ok(store.mismatches.some((m) => m.reason.startsWith("RECONCILE:Wolfsburg")));
});

test("hybrid never blocks markets for BL", () => {
  const store = emptyBlSeasonRosterStore();
  const pick: RecommendedPick = {
    prediction: "Over 2.5",
    confidence: 70,
    pFinal: 70,
    action: "keep",
    judgment: "test",
    accepted: true,
  };
  const out = applyHybridToRecommendedPick(pick, emptyLearnerStats(), {
    leagueName: "Bundesliga",
    marketKey: "total_goals_ou",
    blRoster: store,
    homeTeam: "Bayern Munich",
    awayTeam: "Dortmund",
    matchDate: "2026-09-15",
  });
  assert.equal(out.action, "keep");
  assert.ok(out.hybridConfidence != null);
});
