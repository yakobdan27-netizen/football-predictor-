/**
 * Run: npx tsx lib/prediction-log/conceded-half-model.test.ts
 */
import assert from "node:assert/strict";
import {
  aggregateConcededHalfStats,
  buildConcededMatchLog,
  confidenceBand,
  defensiveProfile,
  predictConcededHalfMatch,
} from "./conceded-half-model";
import type { PredictionBatch } from "./types";

function makeMatch(
  id: string,
  homeTeam: string,
  awayTeam: string,
  homeHt: number,
  homeFt: number,
  awayHt: number,
  awayFt: number,
  matchDate?: string
) {
  return {
    id,
    homeTeam,
    awayTeam,
    matchDate,
    predictions: {},
    actualResults: {},
    scored: {},
    teamStats: {
      home: { goals: homeFt, firstHalfGoals: homeHt },
      away: { goals: awayFt, firstHalfGoals: awayHt },
    },
  };
}

function makeBatch(
  date: string,
  league: string,
  matches: ReturnType<typeof makeMatch>[]
): PredictionBatch {
  return {
    id: `batch-${date}`,
    date,
    league,
    batchName: "test",
    createdAt: `${date}T00:00:00Z`,
    batchKind: "manual",
    matches,
  };
}

// Opponent HT/FT → conceded per side
{
  const batches = [
    makeBatch("2025-09-01", "Premier League", [
      // Home 1-2 FT (HT 0-1): home conceded 1H=1, 2H=1; away conceded 1H=0, 2H=1
      makeMatch("m1", "Arsenal", "Chelsea", 0, 1, 1, 2, "2025-09-01"),
    ]),
  ];
  const log = buildConcededMatchLog(batches);
  assert.equal(log.length, 2);
  const home = log.find((r) => r.team === "Arsenal")!;
  const away = log.find((r) => r.team === "Chelsea")!;
  assert.equal(home.conceded1h, 1);
  assert.equal(home.conceded2h, 1);
  assert.equal(home.homeAway, "H");
  assert.equal(away.conceded1h, 0);
  assert.equal(away.conceded2h, 1);
  assert.equal(away.homeAway, "A");
  assert.equal(home.season, "2025/26");
}

// Aggregation + clean sheets + season=all
{
  const batches = [
    makeBatch("2024-10-01", "Premier League", [
      makeMatch("a", "Arsenal", "Everton", 0, 2, 0, 0, "2024-10-01"), // Arsenal CS both halves
      makeMatch("b", "Arsenal", "Wolves", 1, 1, 2, 3, "2024-10-08"), // Arsenal conc 2H=1? away 2-3: conc1h=2, conc2h=1
    ]),
    makeBatch("2025-09-15", "Premier League", [
      makeMatch("c", "Brighton", "Arsenal", 0, 0, 0, 1, "2025-09-15"), // Arsenal away: conc 0+0
    ]),
  ];
  const log = buildConcededMatchLog(batches);
  const bySeason = aggregateConcededHalfStats(log, {
    league: "Premier League",
    season: "2024/25",
  });
  const arsenal2425 = bySeason.find((t) => t.team === "Arsenal");
  assert.ok(arsenal2425);
  assert.equal(arsenal2425!.liveMatches, 2);
  assert.ok(arsenal2425!.cleanSheet1hPct > 0);
  assert.ok(arsenal2425!.seedSource);

  const all = aggregateConcededHalfStats(log, { league: "Premier League", season: "all" });
  const arsenalAll = all.find((t) => t.team === "Arsenal");
  assert.ok(arsenalAll);
  assert.equal(arsenalAll!.liveMatches, 3);
  assert.equal(arsenalAll!.season, "all");
}

// Profiles
assert.equal(defensiveProfile(1.2, 0.8), "Slow Starter");
assert.equal(defensiveProfile(0.8, 1.2), "Late Collapser");
assert.equal(defensiveProfile(1.0, 1.05), "Balanced Defence");

// Confidence
assert.equal(confidenceBand(60, 35), "high");
assert.equal(confidenceBand(50, 20), "medium");
assert.equal(confidenceBand(70, 10), "low");
assert.equal(confidenceBand(40, 40), "low");

// Thin sample advisory still returns a pick (never blocks)
{
  const pred = predictConcededHalfMatch({
    matchId: "x",
    homeTeam: "Unknown Home",
    awayTeam: "Unknown Away",
    league: "Premier League",
    batches: [],
  });
  assert.ok(pred.recommendation);
  assert.ok(pred.lambda1h > 0 && pred.lambda2h > 0);
  assert.equal(pred.confidence, "low");
  assert.ok(pred.detail.coldStartNote);
  assert.ok(Math.abs(pred.p1hGreater + pred.pEqual + pred.p2hGreater - 1) < 1e-9);
}

// Rich history advisory (both sides need samples to avoid cold-start note)
{
  const arsenalHome = Array.from({ length: 8 }, (_, i) => {
    const month = String(i + 1).padStart(2, "0");
    return makeMatch(`r${i}`, "Arsenal", `Opp${i}`, 0, 1, 1, 2, `2025-${month}-10`);
  });
  const chelseaAway = Array.from({ length: 8 }, (_, i) => {
    const month = String(i + 1).padStart(2, "0");
    return makeMatch(`c${i}`, `Host${i}`, "Chelsea", 1, 2, 0, 1, `2025-${month}-12`);
  });
  const batches = [makeBatch("2025-12-01", "Premier League", [...arsenalHome, ...chelseaAway])];
  const pred = predictConcededHalfMatch({
    matchId: "upcoming",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    league: "Premier League",
    batches,
    beforeDate: "2025-12-01",
  });
  assert.ok(pred.sampleSizeHome >= 6);
  assert.ok(pred.sampleSizeAway >= 6);
  assert.equal(pred.detail.usedVenueSplitHome, true);
  assert.equal(pred.detail.usedVenueSplitAway, true);
  assert.ok(pred.detail.seedBlendHome?.includes("n_live="));
  assert.ok(pred.detail.seedBlendAway?.includes("n_live="));
}

console.log("conceded-half-model tests passed");
