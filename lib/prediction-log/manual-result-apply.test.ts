import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyManualScoreToMatch,
  matchIsManuallyFillable,
  teamsMatchPair,
} from "./manual-result-apply";
import type { LogMatch } from "./types";

function baseMatch(overrides: Partial<LogMatch> = {}): LogMatch {
  return {
    id: "m1",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    predictions: {
      "1x2": { prediction: "home", confidence: 60 },
      ht_1x2: { prediction: "home", confidence: 55 },
    },
    actualResults: {},
    scored: {},
    teamStats: { home: {}, away: {} },
    ...overrides,
  };
}

test("teamsMatchPair same orientation + normalized aliases", () => {
  const a = teamsMatchPair(
    { homeTeam: "Man United", awayTeam: "Liverpool" },
    { homeTeam: "Manchester United", awayTeam: "Liverpool" }
  );
  assert.equal(a.match, true);
  assert.equal(a.homeIsBatchHome, true);
});

test("teamsMatchPair reversed orientation", () => {
  const r = teamsMatchPair(
    { homeTeam: "Arsenal", awayTeam: "Chelsea" },
    { homeTeam: "Chelsea", awayTeam: "Arsenal" }
  );
  assert.equal(r.match, true);
  assert.equal(r.homeIsBatchHome, false);
});

test("teamsMatchPair prefers API team ids", () => {
  const same = teamsMatchPair(
    {
      homeTeam: "A",
      awayTeam: "B",
      homeApiTeamId: 10,
      awayApiTeamId: 20,
    },
    {
      homeTeam: "X",
      awayTeam: "Y",
      homeApiTeamId: 10,
      awayApiTeamId: 20,
    }
  );
  assert.equal(same.match, true);
  assert.equal(same.homeIsBatchHome, true);

  const rev = teamsMatchPair(
    {
      homeTeam: "A",
      awayTeam: "B",
      homeApiTeamId: 10,
      awayApiTeamId: 20,
    },
    {
      homeTeam: "Y",
      awayTeam: "X",
      homeApiTeamId: 20,
      awayApiTeamId: 10,
    }
  );
  assert.equal(rev.match, true);
  assert.equal(rev.homeIsBatchHome, false);
});

test("applyManualScoreToMatch sets FT, scores 1X2, leaves HT alone when HT null", () => {
  const m = applyManualScoreToMatch(
    baseMatch(),
    { ftHome: 2, ftAway: 1 },
    { homeIsBatchHome: true }
  );
  assert.equal(m.teamStats?.home?.goals, 2);
  assert.equal(m.teamStats?.away?.goals, 1);
  assert.equal(m.teamStats?.home?.firstHalfGoals, undefined);
  assert.equal(m.resultSource, "manual");
  assert.equal(m.scored["1x2"], "correct");
  assert.ok(m.scored.ht_1x2 == null || m.scored.ht_1x2 === "void");
  assert.equal(m.actualResults.ht_1x2?.actual, undefined);
});

test("applyManualScoreToMatch swaps when batch orientation reversed", () => {
  const m = applyManualScoreToMatch(
    baseMatch({ homeTeam: "Chelsea", awayTeam: "Arsenal" }),
    { ftHome: 2, ftAway: 1 },
    { homeIsBatchHome: false }
  );
  // Form was Arsenal 2–1 Chelsea; batch is Chelsea vs Arsenal → 1–2
  assert.equal(m.teamStats?.home?.goals, 1);
  assert.equal(m.teamStats?.away?.goals, 2);
});

test("matchIsManuallyFillable skips api-football with FT goals", () => {
  const m = baseMatch({
    resultSource: "api-football",
    teamStats: { home: { goals: 1 }, away: { goals: 0 } },
  });
  assert.equal(matchIsManuallyFillable(m), false);
});

test("matchIsManuallyFillable true when FT missing", () => {
  assert.equal(matchIsManuallyFillable(baseMatch()), true);
});

test("idempotent second apply: already filled is not fillable", () => {
  const first = applyManualScoreToMatch(
    baseMatch(),
    { ftHome: 2, ftAway: 1 },
    { homeIsBatchHome: true }
  );
  assert.equal(matchIsManuallyFillable(first), false);
  assert.equal(first.scored["1x2"], "correct");
});
