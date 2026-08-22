/**
 * Run: npx tsx lib/prediction-log/specialist-data-coverage.test.ts
 */
import assert from "node:assert/strict";
import {
  computeCornersCoverageSync,
  computeHtCoverageSync,
  countTeamBatchFieldCoverage,
} from "./specialist-data-coverage";
import type { ClubHalfAttackDefence } from "./hsh-half-rates";
import type { PredictionBatch } from "./types";
import { loadClubCornersRates } from "./corners-model";

function mkBatchWithHt(): PredictionBatch[] {
  const mkMatch = (
    id: string,
    home: string,
    away: string,
    date: string,
    stats: NonNullable<PredictionBatch["matches"][0]["teamStats"]>
  ) => ({
    id,
    homeTeam: home,
    awayTeam: away,
    matchDate: date,
    predictions: {},
    actualResults: {},
    scored: {},
    teamStats: stats,
  });

  const matches = [];
  for (let i = 0; i < 10; i++) {
    matches.push(
      mkMatch(`m-${i}`, "Arsenal", `Opponent ${i}`, "2025-08-01", {
        home: { goals: 2, firstHalfGoals: 1, corners: 6 },
        away: { goals: 1, firstHalfGoals: 0, corners: 4 },
      })
    );
    matches.push(
      mkMatch(`m-away-${i}`, `Visitor ${i}`, "Chelsea", "2025-08-02", {
        home: { goals: 1, firstHalfGoals: 1, corners: 3 },
        away: { goals: 2, firstHalfGoals: 1, corners: 5 },
      })
    );
  }
  return [
    {
      id: "b1",
      batchName: "test-batch",
      date: "2025-08-10",
      createdAt: "2025-08-10T00:00:00.000Z",
      league: "Premier League",
      matches,
    },
  ];
}

const ratesWithApi = (club: string): ClubHalfAttackDefence => ({
  clubName: club,
  league: "Premier League",
  af1: 1.1,
  af2: 1.0,
  da1: 1.0,
  da2: 1.0,
  nMatches: 20,
  seasonCount: 3,
  seedOnly: false,
  sourceNote: null,
  apiSeasonCurrentN: 8,
  apiSeasonBlend: "60_40",
});

assert.equal(
  countTeamBatchFieldCoverage(
    mkBatchWithHt(),
    "Arsenal",
    "Premier League",
    "ht"
  ).withField,
  10
);

const htCov = computeHtCoverageSync({
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  league: "Premier League",
  batches: mkBatchWithHt(),
  homeRates: ratesWithApi("Arsenal"),
  awayRates: ratesWithApi("Chelsea"),
});

assert.ok(
  htCov.pct != null && htCov.pct >= 30,
  `expected ht_pct >= 30, got ${htCov.pct}`
);
assert.ok(htCov.systemRecords > 0, "system HT records should count batch fills");

const cornersRates = {
  home: loadClubCornersRates("Arsenal", "Premier League", mkBatchWithHt()),
  away: loadClubCornersRates("Chelsea", "Premier League", mkBatchWithHt()),
};

const cornersCov = computeCornersCoverageSync({
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  league: "Premier League",
  batches: mkBatchWithHt(),
  homeCorners: cornersRates.home,
  awayCorners: cornersRates.away,
});

assert.ok(
  cornersCov.pct != null && cornersCov.pct >= 25,
  `expected corners_pct >= 25, got ${cornersCov.pct}`
);

const emptyHt = computeHtCoverageSync({
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  league: "Premier League",
  batches: [],
  homeRates: {
    ...ratesWithApi("Arsenal"),
    apiSeasonCurrentN: 0,
    nMatches: 0,
  },
  awayRates: {
    ...ratesWithApi("Chelsea"),
    apiSeasonCurrentN: 0,
    nMatches: 0,
  },
});

assert.ok(
  emptyHt.pct == null || emptyHt.pct < 30,
  "empty data should not pass HT threshold"
);

console.log("specialist-data-coverage tests passed");
