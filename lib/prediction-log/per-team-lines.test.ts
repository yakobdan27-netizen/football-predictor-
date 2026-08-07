import assert from "node:assert/strict";
import { test } from "node:test";
import { poissonOverLine } from "./poisson-ou";
import {
  PER_TEAM_LINES,
  buildCornersPerTeamBundle,
  buildHtPerTeamBundle,
  buildHtTotalDisplay,
  buildPerTeamLine,
  inferIntensitySource,
  sourceBadgeLabel,
} from "./per-team-lines";
import type { CornersMatchPrediction } from "./corners-model";
import type { HshPrediction } from "./hsh-model";

test("poissonOverLine at λ=line is near 50% for half-lines", () => {
  // For Over 5.5, P(X>=6) with λ=5.5 is slightly under 0.5
  const p = poissonOverLine(5.5, 5.5);
  assert.ok(p > 0.4 && p < 0.55, `expected ~0.5, got ${p}`);
});

test("buildPerTeamLine prices over/under and picks lean", () => {
  const r = buildPerTeamLine({
    side: "home",
    market: "corners",
    intensity: 7.5,
    line: 5.5,
    source: "seed",
    confidence: "high",
  });
  assert.equal(r.insufficient, false);
  assert.ok(r.overPct != null && r.overPct > 0.6);
  assert.equal(r.lean, "over");
});

test("missing source → INSUFFICIENT DATA, no invented pct", () => {
  const r = buildPerTeamLine({
    side: "away",
    market: "corners",
    intensity: 4.5, // floored λ may exist — still withhold when source missing
    line: 4.5,
    source: "missing",
    confidence: "low",
  });
  assert.equal(r.insufficient, true);
  assert.equal(r.overPct, null);
  assert.equal(sourceBadgeLabel(r.source), "INSUFFICIENT DATA");
});

test("inferIntensitySource from notes", () => {
  assert.equal(inferIntensitySource(null), "missing");
  assert.equal(inferIntensitySource("seed 3 seasons"), "seed");
  assert.equal(inferIntensitySource("seed · live n=4"), "live");
  assert.equal(inferIntensitySource("db team_season_stats 2024"), "api_db");
});

test("corners bundle uses defaults and same λ as prediction", () => {
  const pred = {
    matchId: "m",
    homeTeam: "A",
    awayTeam: "B",
    league: "Premier League",
    lambdaHome: 6.2,
    lambdaAway: 3.8,
    expectedTotal: 10,
    pOver95: 0.55,
    pUnder95: 0.45,
    pOver105: 0.4,
    pUnder105: 0.6,
    pHomeOver45: 0.7,
    pAwayOver45: 0.4,
    lean: "over_9.5",
    topProbability: 0.55,
    confidence: "medium",
    detail: {
      homeWon: 6,
      homeConceded: 4,
      awayWon: 4,
      awayConceded: 5,
      leagueBase: 5.2,
      seedHome: "seed 3 seasons",
      seedAway: null,
    },
  } as CornersMatchPrediction;

  const bundle = buildCornersPerTeamBundle(pred, {
    home: PER_TEAM_LINES.corners.homeDefault,
    away: PER_TEAM_LINES.corners.awayDefault,
  });
  assert.equal(bundle.home.line, 5.5);
  assert.equal(bundle.away.line, 4.5);
  assert.equal(bundle.home.insufficient, false);
  assert.equal(bundle.away.insufficient, true);
  assert.ok((bundle.home.overPct ?? 0) > (bundle.away.overPct ?? 0));
});

test("per-team Over + Under sum to 1 for every alternate line", () => {
  for (const intensity of [3.5, 5.5, 7.0]) {
    for (const line of PER_TEAM_LINES.corners.alternates) {
      const r = buildPerTeamLine({
        side: "home",
        market: "corners",
        intensity,
        line,
        source: "seed",
        confidence: "medium",
      });
      assert.ok(r.overPct != null && r.underPct != null);
      assert.ok(Math.abs(r.overPct + r.underPct - 1) < 1e-9);
    }
  }
  for (const intensity of [0.4, 0.9, 1.4]) {
    for (const line of PER_TEAM_LINES.halfGoals.alternates) {
      const r = buildPerTeamLine({
        side: "away",
        market: "halfGoals",
        intensity,
        line,
        source: "live",
        confidence: "high",
      });
      assert.ok(r.overPct != null && r.underPct != null);
      assert.ok(Math.abs(r.overPct + r.underPct - 1) < 1e-9);
    }
  }
});

test("HT total display + per-team from lambdaA1/B1", () => {
  const pred = {
    matchId: "m",
    homeTeam: "A",
    awayTeam: "B",
    league: "Premier League",
    lambda1h: 1.4,
    lambda2h: 1.2,
    p1h: 0.4,
    p2h: 0.35,
    pTie: 0.25,
    recommended: "1H",
    topProbability: 0.4,
    confidence: "medium",
    margin: 0.1,
    expectedDiff: 0.2,
    seDiff: 0.5,
    sampleSizeHome: 12,
    sampleSizeAway: 10,
    usedManualOverride: false,
    valueAlert: false,
    tacticalNote: "",
    detail: {
      lambdaA1: 0.85,
      lambdaB1: 0.55,
      lambdaA2: 0.6,
      lambdaB2: 0.6,
      att1Home: 1,
      att2Home: 1,
      def1Home: 1,
      def2Home: 1,
      att1Away: 1,
      att2Away: 1,
      def1Away: 1,
      def2Away: 1,
      lgAf1: 1,
      lgAf2: 1,
      couplingApplied: false,
      seedHome: "live n=12",
      seedAway: "seed 2 seasons",
    },
  } as HshPrediction;

  const total = buildHtTotalDisplay(pred, 1.5);
  assert.equal(total.label, "TOTAL HT GOALS");
  assert.ok(total.overPct + total.underPct === 1 || Math.abs(total.overPct + total.underPct - 1) < 1e-9);

  const bundle = buildHtPerTeamBundle(pred, {
    home: PER_TEAM_LINES.halfGoals.homeDefault,
    away: PER_TEAM_LINES.halfGoals.awayDefault,
  });
  assert.equal(bundle.home.line, 0.5);
  assert.equal(bundle.home.source, "live");
  assert.equal(bundle.away.source, "seed");
  assert.ok((bundle.home.overPct ?? 0) > (bundle.away.overPct ?? 0));
});
