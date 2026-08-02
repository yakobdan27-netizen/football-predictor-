/**
 * Acceptance smoke for manual-first API assist (no network for gap helper).
 */
import assert from "node:assert/strict";
import {
  isMatchHalfDataGap,
  isTeamHalfDataGap,
  partlyFromApiSources,
} from "../lib/prediction-log/data-gap";
import { predictTwoHHeavy } from "../lib/prediction-log/two-h-heavy/profiles";
import type { LogMatch, PredictionBatch } from "../lib/prediction-log/types";
import { readFileSync } from "node:fs";

{
  assert.equal(
    isTeamHalfDataGap({
      n_matches: 3,
      sc_1h: 0.5,
      sc_2h: 0.6,
      conc_1h: 0.4,
      conc_2h: 0.5,
    }),
    true
  );
  assert.equal(
    isTeamHalfDataGap({
      n_matches: 8,
      sc_1h: 0.5,
      sc_2h: 0.6,
      conc_1h: 0.4,
      conc_2h: 0.5,
    }),
    false
  );
  assert.equal(partlyFromApiSources("api", "db"), true);
  assert.equal(partlyFromApiSources("hist", "db"), false);
}

{
  const match: LogMatch = {
    id: "m1",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    league: "Premier League",
    predictions: {},
    actualResults: {},
    scored: {},
  };
  const batch: PredictionBatch = {
    id: "b1",
    date: "2026-07-20",
    league: "Premier League",
    batchName: "Smoke",
    createdAt: "2026-07-20T00:00:00.000Z",
    matches: [match],
  };
  const result = predictTwoHHeavy({
    match,
    batchLeague: batch.league,
    batches: [batch],
  });
  assert.ok(result.insufficientData);
  assert.equal(result.confidence, 0);
  assert.ok(isMatchHalfDataGap(result.homeProfile, result.awayProfile));
}

{
  const vercel = readFileSync("vercel.json", "utf8");
  assert.ok(
    !/fixtures\/upcoming/.test(
      JSON.parse(vercel).crons?.map((c: { path: string }) => c.path).join(" ") ??
        ""
    ),
    "upcoming fixtures must not be on a cron"
  );
  const crons: string[] = (JSON.parse(vercel).crons ?? []).map(
    (c: { path: string }) => c.path
  );
  assert.ok(
    !crons.some((p) => p.includes("two-h-heavy")),
    "no two-h-heavy cron"
  );
}

console.log("manual-first smoke checks passed");
