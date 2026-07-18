import assert from "node:assert/strict";
import { buildHalfSplitsCache, secondHalfGoals } from "./half-splits-cache";
import type { PredictionBatch } from "./types";

function makeMatch(
  homeTeam: string,
  awayTeam: string,
  homeHt: number,
  homeFt: number,
  awayHt: number,
  awayFt: number
) {
  return {
    id: `${homeTeam}-${awayTeam}`,
    homeTeam,
    awayTeam,
    predictions: {},
    actualResults: {},
    scored: {},
    teamStats: {
      home: { goals: homeFt, firstHalfGoals: homeHt },
      away: { goals: awayFt, firstHalfGoals: awayHt },
    },
  };
}

function makeBatch(date: string, league: string, matches: ReturnType<typeof makeMatch>[]): PredictionBatch {
  return {
    id: `batch-${date}`,
    date,
    league,
    batchName: "test",
    createdAt: `${date}T12:00:00.000Z`,
    batchKind: "manual",
    matches,
  };
}

assert.equal(secondHalfGoals(3, 1), 2);
assert.equal(secondHalfGoals(1, 1), 0);
assert.equal(secondHalfGoals(0, 1), 0);

const batches = [
  makeBatch("2026-01-01", "EPL", [makeMatch("Arsenal", "Chelsea", 1, 2, 0, 1)]),
  makeBatch("2026-01-08", "EPL", [makeMatch("Arsenal", "Liverpool", 2, 3, 1, 1)]),
];

const cache = buildHalfSplitsCache(batches);
const a1 = cache.teamShare("Arsenal", "home", { beforeDate: "2026-01-10" });
const a2 = cache.teamShare("Arsenal", "home", { beforeDate: "2026-01-10" });
assert.equal(a1, a2);
assert.ok(a1.sample >= 2);
assert.ok(a1.share1h > 0 && a1.share1h < 1);

const league = cache.leagueShare("EPL", { beforeDate: "2026-01-10" });
assert.ok(league.sample >= 2);

console.log("half-splits-cache tests passed");
