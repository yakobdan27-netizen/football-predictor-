import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateComboResults,
  scoreComboLeg,
} from "./combo-scoring";
import {
  deriveActualsFromFacts,
  explainMarketGrade,
  gradeFrozenAlternative,
  gradeMatchFromFacts,
} from "./grade-from-facts";
import { applyTeamStatsSync } from "./team-stats-sync";
import type { FrozenBetterAlternative, LogMatch } from "./types";

function baseMatch(overrides: Partial<LogMatch> = {}): LogMatch {
  return {
    id: "m1",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    predictions: {
      "1x2": { prediction: "home", confidence: 60 },
    },
    actualResults: {},
    scored: {},
    teamStats: { home: {}, away: {} },
    ...overrides,
  };
}

test("FT goals grade 1x2 / DC / BTTS / total goals", () => {
  const m = gradeMatchFromFacts(
    baseMatch({
      predictions: {
        "1x2": { prediction: "home", confidence: 60 },
        double_chance: { prediction: "1x", confidence: 55 },
        btts: { prediction: "yes", confidence: 50 },
        total_goals_ou: { prediction: "under", line: 4.5, confidence: 50 },
      },
      teamStats: { home: { goals: 2 }, away: { goals: 1 } },
    })
  );
  assert.equal(m.scored["1x2"], "correct");
  assert.equal(m.scored.double_chance, "correct");
  assert.equal(m.scored.btts, "correct");
  assert.equal(m.scored.total_goals_ou, "correct");
  assert.equal(m.primaryGrade?.result, "correct");
});

test("missing away goals → void not wrong", () => {
  const m = gradeMatchFromFacts(
    baseMatch({
      teamStats: { home: { goals: 2 }, away: {} },
    })
  );
  assert.equal(m.scored["1x2"], "void");
  assert.equal(m.primaryGrade?.result, "void");
  assert.match(m.primaryGrade?.reason ?? "", /Void/i);
});

test("abnormalMatch → void", () => {
  const m = gradeMatchFromFacts(
    baseMatch({
      teamStats: {
        home: { goals: 2 },
        away: { goals: 1 },
        abnormalMatch: true,
      },
    })
  );
  assert.equal(m.scored["1x2"], "void");
  assert.equal(m.primaryGrade?.result, "void");
});

test("O/U push on exact line", () => {
  const m = gradeMatchFromFacts(
    baseMatch({
      predictions: {
        home_goals_ou: { prediction: "over", line: 1.5, confidence: 50 },
      },
      teamStats: { home: { goals: 1.5 as unknown as number }, away: { goals: 0 } },
    })
  );
  // goals are ints in practice — use corners for push
  const corners = gradeMatchFromFacts(
    baseMatch({
      predictions: {
        corners_ou: { prediction: "over", line: 9.5, confidence: 50 },
      },
      teamStats: {
        home: { goals: 1, corners: 5 },
        away: { goals: 0, corners: 4.5 as unknown as number },
      },
    })
  );
  void m;
  // Use integer total that equals line via shots
  const shots = gradeMatchFromFacts(
    baseMatch({
      predictions: {
        shots_ou: { prediction: "over", line: 20.5, confidence: 50 },
      },
      teamStats: {
        home: { goals: 1, totalShots: 10 },
        away: { goals: 0, totalShots: 10 },
      },
    })
  );
  // 20 !== 20.5 so under → wrong for over
  assert.equal(shots.scored.shots_ou, "wrong");

  const push = gradeMatchFromFacts(
    baseMatch({
      predictions: {
        home_goals_ou: { prediction: "over", line: 2, confidence: 50 },
      },
      teamStats: { home: { goals: 2 }, away: { goals: 0 } },
    })
  );
  assert.equal(push.scored.home_goals_ou, "push");
  void corners;
});

test("combo all-correct / one-wrong / void", () => {
  const ok = scoreComboLeg(
    "home_btts_yes",
    {},
    { home: { goals: 2 }, away: { goals: 1 } }
  );
  assert.equal(ok, "correct");

  const miss = scoreComboLeg(
    "home_btts_yes",
    {},
    { home: { goals: 2 }, away: { goals: 0 } }
  );
  assert.equal(miss, "wrong");

  const missing = scoreComboLeg("home_btts_yes", {}, { home: {}, away: {} });
  assert.equal(missing, "void");

  assert.equal(aggregateComboResults(["correct", "correct"]), "correct");
  assert.equal(aggregateComboResults(["correct", "wrong"]), "wrong");
  assert.equal(aggregateComboResults(["correct", "void"]), "void");
});

test("fhGoals-based combo grades after fix", () => {
  const r = scoreComboLeg(
    "over_0_5_fh_over_2_5_ft",
    {},
    {
      home: { goals: 2, firstHalfGoals: 1 },
      away: { goals: 1, firstHalfGoals: 0 },
    }
  );
  assert.equal(r, "correct");
});

test("silent derive fills corners without corners prediction", () => {
  const derived = deriveActualsFromFacts(
    baseMatch({
      predictions: { "1x2": { prediction: "home", confidence: 60 } },
      teamStats: {
        home: { goals: 1, corners: 6 },
        away: { goals: 0, corners: 5 },
      },
    })
  );
  assert.equal(derived.corners_ou?.actual, 11);
  assert.equal(derived["1x2"]?.actual, "home");

  const graded = gradeMatchFromFacts(
    baseMatch({
      predictions: { "1x2": { prediction: "home", confidence: 60 } },
      teamStats: {
        home: { goals: 1, corners: 6 },
        away: { goals: 0, corners: 5 },
      },
    })
  );
  assert.equal(graded.silentGrades?.corners_ou?.actual, 11);
  assert.equal(graded.silentGrades?.corners_ou?.result, null);
});

test("alt grade when frozen prediction present", () => {
  const alt: FrozenBetterAlternative = {
    marketKey: "double_chance",
    marketLabel: "Double chance",
    predictionLabel: "1X",
    prediction: "1x",
    pFinal: 70,
    deltaPct: 10,
    isOptimal: false,
  };
  const m = gradeMatchFromFacts(
    baseMatch({
      predictions: {
        "1x2": { prediction: "away", confidence: 40 },
      },
      teamStats: { home: { goals: 2 }, away: { goals: 1 } },
    }),
    { betterAlternative: alt }
  );
  assert.equal(m.primaryGrade?.result, "wrong");
  assert.equal(m.altGrade?.result, "correct");
});

test("explanation string non-empty on wrong BTTS", () => {
  const m = gradeMatchFromFacts(
    baseMatch({
      predictions: {
        btts: { prediction: "yes", confidence: 50 },
      },
      teamStats: { home: { goals: 2 }, away: { goals: 0 } },
    })
  );
  assert.equal(m.scored.btts, "wrong");
  assert.ok((m.primaryGrade?.reason ?? "").length > 10);
  assert.match(
    explainMarketGrade("btts", "yes", undefined, "no", "wrong"),
    /both teams to score/i
  );
});

test("applyTeamStatsSync live-grades as facts change", () => {
  const m = applyTeamStatsSync(
    baseMatch({
      teamStats: { home: { goals: 1 }, away: { goals: 0 } },
    })
  );
  assert.equal(m.scored["1x2"], "correct");
  assert.ok(m.primaryGrade);
});
