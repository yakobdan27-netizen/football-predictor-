/**
 * Run: npx tsx lib/prediction-log/two-h-heavy/profiles.test.ts
 */
import assert from "node:assert/strict";
import { predictTwoHHeavy, resolveTeamHalfProfile } from "./profiles";
import type { LogMatch, PredictionBatch } from "../types";

function emptyMatch(partial: Partial<LogMatch> & Pick<LogMatch, "id" | "homeTeam" | "awayTeam">): LogMatch {
  return {
    predictions: {},
    actualResults: {},
    scored: {},
    ...partial,
  };
}

const batch: PredictionBatch = {
  id: "b1",
  date: "2026-07-20",
  league: "Premier League",
  batchName: "Test",
  createdAt: "2026-07-20T00:00:00.000Z",
  matches: [
    emptyMatch({ id: "m1", homeTeam: "Arsenal", awayTeam: "Chelsea", league: "Premier League" }),
  ],
};

{
  const home = resolveTeamHalfProfile("Arsenal", "home", "Premier League", [batch]);
  assert.ok(home.source === "db" || home.source === "prior", home.source);
  assert.ok(home.sc_1h >= 0 && home.sc_2h >= 0);
  // Seed-only → n_matches 0 → thin warning path
  assert.equal(home.n_matches, 0);
}

{
  const unknown = resolveTeamHalfProfile("ZZZ FC Nobody", "home", "Premier League", []);
  assert.equal(unknown.source, "prior");
  assert.ok(unknown.sc_1h > 0);
}

{
  const result = predictTwoHHeavy({
    match: batch.matches[0]!,
    batchLeague: batch.league,
    batches: [batch],
  });
  assert.ok(result.p_2h_gt_1h > 0);
  assert.ok(["db", "prior"].includes(result.data_source));
  assert.ok(result.thinData); // seed-only n=0
  assert.ok(result.insufficientData);
  assert.equal(result.confidence, 0);
  assert.equal(result.partlyFromApi, false);
  const sum = result.p_2h_gt_1h + result.p_2h_eq_1h + result.p_2h_lt_1h;
  assert.ok(Math.abs(sum - 1) < 1e-4, `sum=${sum}`);
}

console.log("two-h-heavy profiles tests passed");
