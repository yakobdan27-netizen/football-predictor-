/**
 * Run: npx tsx lib/prediction-log/hsh-half-rates.test.ts
 */
import assert from "node:assert/strict";
import {
  loadClubHalfAttackDefence,
  loadLeagueAfBaselines,
  shrinkCoeff,
} from "./hsh-half-rates";
import { SHRINKAGE_K } from "./model-config";
import type { PredictionBatch } from "./types";

{
  // Rich sample: no shrink
  assert.equal(shrinkCoeff(1.4, 40, 5), 1.4);
  // Thin: pull toward 1.0
  const thin = shrinkCoeff(1.4, 5, 1);
  assert.ok(thin < 1.4 && thin > 1.0, `thin shrink toward 1, got ${thin}`);
  const phi = 5 / (5 + SHRINKAGE_K);
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
  assert.ok(cityLive.sourceNote?.includes("prior-live"));
  assert.ok(cityLive.nMatches > 0);
}

{
  // Legacy nested MC 60/40 only when system-season blend flag is off
  const prevFlag = process.env.SYSTEM_SEASON_BLEND_ENABLED;
  process.env.SYSTEM_SEASON_BLEND_ENABLED = "0";

  const batches: PredictionBatch[] = [
    {
      id: "b26",
      date: "2026-09-01",
      league: "Premier League",
      batchName: "t",
      createdAt: new Date().toISOString(),
      batchKind: "manual",
      matches: [
        {
          id: "m26",
          homeTeam: "Manchester City",
          awayTeam: "Everton",
          matchDate: "2026-09-15",
          predictions: {},
          actualResults: {},
          scored: {},
          teamStats: {
            home: { goals: 2, firstHalfGoals: 1 },
            away: { goals: 0, firstHalfGoals: 0 },
          },
        },
      ],
    },
  ];

  const withoutMc = loadClubHalfAttackDefence("Manchester City", "Premier League", batches);
  assert.ok(
    !withoutMc.sourceNote?.includes("prior-live"),
    "2026/27 batch should not feed prior-live"
  );

  const mcCache = new Map([
    [
      "man city|premier league",
      {
        clubName: "Manchester City",
        league: "Premier League",
        af1: 2.0,
        af2: 2.5,
        da1: 0.3,
        da2: 0.4,
        nMatches: 8,
        seasonCount: 1,
        seedOnly: false,
        sourceNote: "match-centre: 2026 n=8",
      },
    ],
  ]);

  const withMc = loadClubHalfAttackDefence("Manchester City", "Premier League", batches, {
    matchCentreCache: mcCache,
  });
  assert.equal(withMc.apiSeasonBlend, "60_40");
  assert.equal(withMc.apiSeasonCurrentN, 8);
  assert.ok(withMc.sourceNote?.includes("api-season: 60/40"));
  assert.ok(withMc.af1 > withoutMc.af1, "60/40 blend should pull toward MC current rates");

  process.env.SYSTEM_SEASON_BLEND_ENABLED = prevFlag;
}

{
  process.env.SYSTEM_SEASON_BLEND_ENABLED = "1";
  const last5Cache = new Map([
    [
      "man city|premier league",
      {
        clubName: "Manchester City",
        league: "Premier League",
        af1: 2.0,
        af2: 2.5,
        da1: 0.3,
        da2: 0.4,
        nMatches: 5,
        seasonCount: 1,
        seedOnly: false,
        sourceNote: "match-centre-last5: 2026 n=5",
      },
    ],
  ]);
  const withFlag = loadClubHalfAttackDefence("Manchester City", "Premier League", [], {
    recentLast5Cache: last5Cache,
  });
  assert.ok(
    withFlag.apiSeasonBlend == null || withFlag.apiSeasonBlend !== "60_40",
    "system season blend on → no nested MC 60/40 on API side"
  );
  assert.ok(withFlag.sourceNote?.includes("blend: 30/30/40"));
  assert.ok(withFlag.recentLast5?.nMatches === 5);
}

{
  const prevFlag = process.env.SYSTEM_SEASON_BLEND_ENABLED;
  process.env.SYSTEM_SEASON_BLEND_ENABLED = "0";

  const mcThin = new Map([
    [
      "man city|premier league",
      {
        clubName: "Manchester City",
        league: "Premier League",
        af1: 2.0,
        af2: 2.5,
        da1: 0.3,
        da2: 0.4,
        nMatches: 3,
        seasonCount: 1,
        seedOnly: false,
        sourceNote: "match-centre: 2026 n=3",
      },
    ],
  ]);
  const thin = loadClubHalfAttackDefence("Manchester City", "Premier League", [], {
    matchCentreCache: mcThin,
  });
  assert.equal(thin.apiSeasonBlend, "prior_only");
  assert.ok(thin.sourceNote?.includes("api-season: prior_only"));

  process.env.SYSTEM_SEASON_BLEND_ENABLED = prevFlag;
}

console.log("hsh-half-rates tests passed");
