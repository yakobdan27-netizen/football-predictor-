/**
 * Run: npx tsx lib/prediction-log/hsh-half-rates.test.ts
 */
import assert from "node:assert/strict";
import {
  loadClubHalfAttackDefence,
  loadLeagueAfBaselines,
  shrinkCoeff,
} from "./hsh-half-rates";
import type { PredictionBatch } from "./types";

{
  // Rich sample: no shrink
  assert.equal(shrinkCoeff(1.4, 40, 5), 1.4);
  // Thin: pull toward 1.0
  const thin = shrinkCoeff(1.4, 5, 1);
  assert.ok(thin < 1.4 && thin > 1.0, `thin shrink toward 1, got ${thin}`);
  const phi = 5 / (5 + 15);
  assert.ok(Math.abs(thin - (phi * 1.4 + (1 - phi) * 1)) < 1e-9);
}

{
  const lg = loadLeagueAfBaselines("Premier League");
  assert.ok(lg.lgAf1 > 0.3 && lg.lgAf1 < 1.0);
  assert.ok(lg.lgAf2 > lg.lgAf1, "2H league AF should exceed 1H");
}

{
  const city = loadClubHalfAttackDefence("Manchester City", "Premier League", []);
  assert.ok(city.af1 > 0);
  assert.ok(city.af2 > city.af1 || city.af2 > 0);
  assert.ok(city.da1 > 0 && city.da2 > 0);
  assert.equal(city.seedOnly, true, "no live batches → seed-only");
  assert.ok(city.seasonCount >= 3, "City has multi-season seed");
  assert.ok(city.sourceNote);
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
            home: { goals: 3, firstHalfGoals: 1 },
            away: { goals: 1, firstHalfGoals: 0 },
          },
        },
      ],
    },
  ];

  const cityLive = loadClubHalfAttackDefence("Manchester City", "Premier League", batches, {
    beforeDate: "2025-09-01",
  });
  assert.equal(cityLive.seedOnly, false);
  assert.ok(cityLive.sourceNote?.includes("live"));
  assert.ok(cityLive.nMatches > 0);
}

console.log("hsh-half-rates tests passed");
