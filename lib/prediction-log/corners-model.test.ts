/**
 * Run: npx tsx lib/prediction-log/corners-model.test.ts
 */
import assert from "node:assert/strict";
import {
  loadClubCornersRates,
  predictCornersMatch,
} from "./corners-model";
import type { PredictionBatch } from "./types";

{
  const city = loadClubCornersRates("Manchester City", "Premier League", []);
  const everton = loadClubCornersRates("Everton", "Premier League", []);
  assert.equal(city.seedOnly, true);
  assert.ok(city.won > everton.won, "City should win more corners than Everton");
  assert.ok(city.conceded < everton.conceded);

  const pred = predictCornersMatch({
    matchId: "m1",
    homeTeam: "Manchester City",
    awayTeam: "Everton",
    league: "Premier League",
    batches: [],
  });

  assert.ok(pred.lambdaHome > pred.lambdaAway, "City home λ should exceed Everton away λ");
  assert.ok(pred.expectedTotal > 9, `E[total] should be high, got ${pred.expectedTotal}`);
  assert.ok(Math.abs(pred.pOver95 + pred.pUnder95 - 1) < 1e-9);
  assert.ok(Math.abs(pred.pOver105 + pred.pUnder105 - 1) < 1e-9);
  assert.ok(pred.pOver95 > 0.4, "City vs Everton should lean Over 9.5");
  assert.equal(pred.lean, "over_9.5");
  // Multi-season seeds → not forced low
  assert.ok(pred.confidence === "high" || pred.confidence === "medium");
}

{
  // Unknown club with no seed → low confidence
  const pred = predictCornersMatch({
    matchId: "m2",
    homeTeam: "Nobody FC",
    awayTeam: "Ghost United",
    league: "Premier League",
    batches: [],
  });
  assert.equal(pred.confidence, "low");
}

{
  const batches: PredictionBatch[] = [
    {
      id: "b1",
      date: "2025-08-10",
      league: "Premier League",
      batchName: "t",
      createdAt: new Date().toISOString(),
      batchKind: "manual",
      matches: [
        {
          id: "m1",
          homeTeam: "Manchester City",
          awayTeam: "Everton",
          predictions: {},
          actualResults: {},
          scored: {},
          teamStats: {
            home: { corners: 10 },
            away: { corners: 2 },
          },
        },
      ],
    },
  ];

  const cityLive = loadClubCornersRates("Manchester City", "Premier League", batches, {
    beforeDate: "2025-09-01",
  });
  assert.equal(cityLive.seedOnly, false);
  assert.ok(cityLive.sourceNote?.includes("live"));
  assert.ok(cityLive.liveMatches >= 1);
}

console.log("corners-model tests passed");
