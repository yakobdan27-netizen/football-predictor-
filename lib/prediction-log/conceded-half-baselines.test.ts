/**
 * Run: npx tsx lib/prediction-log/conceded-half-baselines.test.ts
 */
import assert from "node:assert/strict";
import {
  allConcededHalfBaselines,
  blendSeedAndLive,
  lookupClubConcededBaseline,
  lookupClubConcededRecencyBlend,
  seedConfidence,
} from "./conceded-half-baselines";
import {
  aggregateConcededHalfStats,
  buildConcededMatchLog,
  predictConcededHalfMatch,
} from "./conceded-half-model";
import type { PredictionBatch } from "./types";

const rows = allConcededHalfBaselines();
assert.ok(rows.length >= 380, `expected >=380 seed rows, got ${rows.length}`);

{
  const city = lookupClubConcededBaseline("Man City", "Premier League", "2024/25");
  assert.ok(city);
  assert.equal(city!.avg1hConceded, 0.5);

  const psg = lookupClubConcededBaseline("Paris SG", "Ligue 1", "2023/24");
  assert.ok(psg);
  assert.ok(psg!.avgConceded < 1.2);
}

{
  const blend = lookupClubConcededRecencyBlend("Arsenal", "Premier League");
  assert.ok(blend);
  assert.ok(blend!.seasonCount >= 3);
  // Recency weights newer seasons higher — 2025/26 avg1h=0.34 should pull below mid seasons
  const old = lookupClubConcededBaseline("Arsenal", "Premier League", "2021/22")!;
  const recent = lookupClubConcededBaseline("Arsenal", "Premier League", "2025/26")!;
  assert.ok(blend!.avg1hConceded < old.avg1hConceded || blend!.avg1hConceded <= recent.avg1hConceded + 0.2);
}

assert.equal(blendSeedAndLive(1, 38, 2, 0), 1);
assert.equal(blendSeedAndLive(1, 38, 2, 38), 1.5);
assert.ok(Math.abs(blendSeedAndLive(1, 10, 3, 90) - 2.8) < 1e-9);

{
  const blend = lookupClubConcededRecencyBlend("Arsenal", "Premier League")!;
  assert.equal(seedConfidence(blend, 0), "low", "seed-only is low");
  const confWithLive = seedConfidence(blend, 5);
  assert.ok(confWithLive === "high" || confWithLive === "medium");
}

{
  const empty = aggregateConcededHalfStats([], {
    league: "Premier League",
    season: "2024/25",
  });
  assert.ok(empty.length >= 18, "seed-only table populates PL clubs");
  const arsenal = empty.find((t) => t.team === "Arsenal");
  assert.ok(arsenal);
  assert.equal(arsenal!.liveMatches, 0);
  assert.equal(arsenal!.confidence, "low");
  assert.ok(arsenal!.seedSource);
}

// Live fades seed: more live matches → closer to live avg
{
  function makeMatch(
    id: string,
    homeHt: number,
    homeFt: number,
    awayHt: number,
    awayFt: number,
    date: string
  ) {
    return {
      id,
      homeTeam: "Arsenal",
      awayTeam: "Everton",
      matchDate: date,
      predictions: {},
      actualResults: {},
      scored: {},
      teamStats: {
        home: { goals: homeFt, firstHalfGoals: homeHt },
        away: { goals: awayFt, firstHalfGoals: awayHt },
      },
    };
  }
  // Arsenal concedes 3 every half (extreme) — live avg1h = 3
  const matches = Array.from({ length: 20 }, (_, i) =>
    makeMatch(`m${i}`, 0, 0, 3, 6, `2025-${String((i % 9) + 1).padStart(2, "0")}-10`)
  );
  const batches: PredictionBatch[] = [
    {
      id: "b1",
      date: "2025-12-01",
      league: "Premier League",
      batchName: "t",
      createdAt: "2025-12-01T00:00:00Z",
      batchKind: "manual",
      matches,
    },
  ];
  const log = buildConcededMatchLog(batches);
  const thinPred = predictConcededHalfMatch({
    matchId: "x",
    homeTeam: "Chelsea",
    awayTeam: "Arsenal",
    league: "Premier League",
    batches: [],
  });
  const richPred = predictConcededHalfMatch({
    matchId: "y",
    homeTeam: "Chelsea",
    awayTeam: "Arsenal",
    league: "Premier League",
    batches,
    beforeDate: "2025-12-01",
    logRows: log,
  });
  // With lots of live concede samples, Arsenal's blended 1H conceded should rise toward 3
  assert.ok(
    richPred.detail.awayAvg1hConceded > thinPred.detail.awayAvg1hConceded,
    `live should pull concede up: rich=${richPred.detail.awayAvg1hConceded} thin=${thinPred.detail.awayAvg1hConceded}`
  );
  assert.ok(richPred.detail.seedBlendAway?.includes("n_live=20"));
}

console.log("conceded-half-baselines tests passed");
