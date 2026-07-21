import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RESEARCH_LEAGUE_PRIOR_SEEDS,
  applyLeaguePriorConfidenceModifier,
  emptyLeaguePriorsStore,
  getLeaguePrior,
  lateGoalTempoScale,
  priorWeightFromSample,
  shrinkTowardLeaguePrior,
  LEAGUE_PRIOR_FULL_SAMPLE,
} from "./league-priors";
import { applyHalfTempoNudges, emptyHalfTempoProfile } from "./half-tempo";
import { selectDiverseTopThree } from "./decision-maker/decision-engine";
import type { ScoredDecisionMarket } from "./decision-maker/types";

test("research seeds cover big five", () => {
  assert.ok(RESEARCH_LEAGUE_PRIOR_SEEDS.premier_league);
  assert.ok(RESEARCH_LEAGUE_PRIOR_SEEDS.la_liga);
  assert.ok(RESEARCH_LEAGUE_PRIOR_SEEDS.serie_a);
  assert.ok(RESEARCH_LEAGUE_PRIOR_SEEDS.ligue_1);
  assert.ok((RESEARCH_LEAGUE_PRIOR_SEEDS.premier_league!.over25_rate ?? 0) > 50);
  assert.ok((RESEARCH_LEAGUE_PRIOR_SEEDS.ligue_1!.late_goal_share ?? 0) > 30);
});

test("getLeaguePrior returns seed when store empty", () => {
  const r = getLeaguePrior("Premier League", { market: "over25", matchSampleSize: 0 });
  assert.equal(r.prior.leagueId, "premier_league");
  assert.ok(r.marketValue != null);
  assert.ok(r.priorWeight > 0.9);
});

test("priorWeightFromSample shrinks to ~0 at FULL_SAMPLE", () => {
  assert.equal(priorWeightFromSample(0), 1);
  assert.ok(priorWeightFromSample(4) > 0.4 && priorWeightFromSample(4) < 0.6);
  assert.equal(priorWeightFromSample(LEAGUE_PRIOR_FULL_SAMPLE), 0);
  assert.equal(priorWeightFromSample(20), 0);
});

test("shrinkTowardLeaguePrior blends by sample", () => {
  const thin = shrinkTowardLeaguePrior(80, 50, 0);
  assert.equal(thin, 50);
  const full = shrinkTowardLeaguePrior(80, 50, LEAGUE_PRIOR_FULL_SAMPLE);
  assert.equal(full, 80);
  const mid = shrinkTowardLeaguePrior(80, 50, 4);
  assert.ok(mid > 50 && mid < 80);
});

test("applyLeaguePriorConfidenceModifier never zeros confidence", () => {
  const prior = {
    ...RESEARCH_LEAGUE_PRIOR_SEEDS.premier_league!,
    updatedAt: new Date().toISOString(),
  };
  const aligned = applyLeaguePriorConfidenceModifier(60, "Over 2.5", "total_goals_ou", prior);
  assert.ok(aligned.confidence >= 60);
  assert.equal(aligned.priorAlign, 1);

  const underPrior = {
    ...prior,
    over25_rate: 40,
  };
  const fights = applyLeaguePriorConfidenceModifier(60, "Over 2.5", "total_goals_ou", underPrior);
  assert.ok(fights.confidence < 60);
  assert.ok(fights.confidence > 0);
  assert.equal(fights.priorAlign, -1);
  assert.ok(fights.warn);
});

test("selectDiverseTopThree still returns 3 after prior scores", () => {
  const scored: ScoredDecisionMarket[] = [
    {
      marketKey: "g1",
      label: "Goals",
      prediction: "Over",
      confidence: 70,
      category: "goals",
      pageId: "a",
      pageLabel: "A",
      totalScore: 20,
      contributingPages: ["a"],
      priorAlign: -1,
    },
    {
      marketKey: "c1",
      label: "Corners",
      prediction: "Over 9.5",
      confidence: 68,
      category: "corners",
      pageId: "a",
      pageLabel: "A",
      totalScore: 18,
      contributingPages: ["a"],
      priorAlign: 1,
    },
    {
      marketKey: "s1",
      label: "Special",
      prediction: "Home",
      confidence: 65,
      category: "specialized",
      pageId: "a",
      pageLabel: "A",
      totalScore: 16,
      contributingPages: ["a"],
      priorAlign: 0,
    },
  ];
  const top = selectDiverseTopThree(scored);
  assert.equal(top.length, 3);
});

test("lateGoalTempoScale raises 2H nudge for Ligue 1-like share", () => {
  const empty = emptyHalfTempoProfile();
  const late = { ...empty, isLateSurger: true, sampleWithTiming: 5 };
  const base = applyHalfTempoNudges(1, 1, empty, late);
  const ligue = applyHalfTempoNudges(1, 1, empty, late, {
    lateGoalShare: RESEARCH_LEAGUE_PRIOR_SEEDS.ligue_1!.late_goal_share,
  });
  assert.ok(ligue.lambda2h > base.lambda2h);
  assert.ok(lateGoalTempoScale(36) > 1);
  assert.ok(lateGoalTempoScale(22) < 1);
});

test("emptyLeaguePriorsStore seeds big five", () => {
  const store = emptyLeaguePriorsStore();
  assert.equal(Object.keys(store.priors).length, 4);
});
