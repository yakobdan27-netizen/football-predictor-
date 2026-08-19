import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blendMatchupLambdas,
  buildLeagueMatchupAnalysis,
} from "./league-matchup-analysis";
import { PREDICTION_WEIGHTS } from "./prediction-weights";

test("blendMatchupLambdas uses 60/40 when API and form both present", () => {
  const api = { lambdaHome: 2.0, lambdaAway: 1.0 };
  const form = { lambdaHome: 1.0, lambdaAway: 2.0 };
  const b = blendMatchupLambdas(api, form);
  assert.equal(b.blendSource, "blended");
  assert.equal(b.apiWeight, PREDICTION_WEIGHTS.apiDb);
  assert.equal(b.formWeight, PREDICTION_WEIGHTS.manualAi);
  assert.equal(b.lambdaHome, 0.6 * 2 + 0.4 * 1);
  assert.equal(b.lambdaAway, 0.6 * 1 + 0.4 * 2);
});

test("blendMatchupLambdas falls back to form when API missing", () => {
  const form = { lambdaHome: 1.5, lambdaAway: 1.2 };
  const b = blendMatchupLambdas(null, form);
  assert.equal(b.blendSource, "manual_ai_only");
  assert.equal(b.lambdaHome, 1.5);
  assert.equal(b.lambdaAway, 1.2);
});

test("buildLeagueMatchupAnalysis produces valid probability grid", () => {
  const a = buildLeagueMatchupAnalysis(
    "A",
    "B",
    "Premier League",
    1.6,
    1.1,
    "test"
  );
  const sum =
    a.winProbability.home + a.winProbability.draw + a.winProbability.away;
  assert.ok(sum > 99 && sum < 101);
  assert.ok(a.overUnder25.over + a.overUnder25.under > 99);
});
