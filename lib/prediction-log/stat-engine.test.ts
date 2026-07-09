import assert from "node:assert/strict";
import { buildScoreMatrix } from "@/lib/predictor/score-matrix";
import { STAT_ENGINE_CONFIG } from "./stat-engine-config";
import { computeDixonColes } from "./statistics-engine";
import { trainClassifier, predictMlOutcome, mlProbToPercent } from "./ml-engine";
import { blendSignalWithStat, shrinkPStat } from "./stat-probability";
import type { ClubRecord } from "./club-record-types";
import { createClubRecord } from "./club-record-types";
import { recomputeStatMetadata } from "./club-stat-metadata";
import type { TrainingFeatureRow } from "./training-data";

// Grid sums to 1
const grid = buildScoreMatrix(1.4, 1.1, STAT_ENGINE_CONFIG.DIXON_COLES_RHO, 8);
const total = grid.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
assert.ok(Math.abs(total - 1) < 1e-6);

// τ correction: 0-0 cell differs from independent Poisson
const independent00 =
  Math.exp(-1.4) * Math.exp(-1.1);
assert.notEqual(grid[0]![0]!, independent00);

// Strong home metadata yields higher home win prob
const strongHome = createClubRecord("h1", "Alpha", "Premier League");
strongHome.statMetadata = recomputeStatMetadata(
  {
    ...strongHome,
    capacity: { ...strongHome.capacity, sampleSize: 10 },
    histories: {
      ...strongHome.histories,
      goalsScored: [
        {
          id: "1",
          date: "2026-01-01",
          batchId: "b",
          matchId: "m",
          opponentId: "o",
          opponentName: "Beta",
          venue: "home",
          predicted: 2,
          actual: 3,
          result: "hit",
        },
      ],
    },
  },
  { "Premier League": { league: "Premier League", league_avg_home_goals: 1.5, league_avg_away_goals: 1.2, sampleSize: 20 } },
  null
);

const weakAway = createClubRecord("a1", "Beta", "Premier League");
weakAway.statMetadata = recomputeStatMetadata(weakAway, null, null);

const dc = computeDixonColes(strongHome, weakAway, "Premier League", "1x2", "home", undefined, {
  "Premier League": { league: "Premier League", league_avg_home_goals: 1.5, league_avg_away_goals: 1.2, sampleSize: 20 },
});
assert.ok(dc.marketProbs.home > dc.marketProbs.away);

// ML logistic probabilities sum ~1
const rows: TrainingFeatureRow[] = [];
for (let i = 0; i < 30; i++) {
  const label = i % 3 === 0 ? "home" : i % 3 === 1 ? "draw" : "away";
  rows.push({
    features: [1 + i * 0.01, 1, 1, 1, 0.9, 1, 1, 1, 1.5, 1.2, 2, 1.5, 0, 0.5, 1.2, 1.0, 0.55],
    label,
    matchId: `m${i}`,
    batchId: "b",
  });
}
const trained = trainClassifier(rows);
assert.equal(trained.algorithm, "logistic");
const probs = predictMlOutcome(trained, rows[0]!.features);
const sum = probs.home + probs.draw + probs.away;
assert.ok(Math.abs(sum - 1) < 0.01);

// Blend respects STAT_VS_CUSTOM
const blended = blendSignalWithStat(70, 50);
assert.equal(blended, Math.round(STAT_ENGINE_CONFIG.STAT_VS_CUSTOM * 70 + (1 - STAT_ENGINE_CONFIG.STAT_VS_CUSTOM) * 50));

// Low sample shrinks toward 50
assert.equal(shrinkPStat(80, 0), 50);
assert.equal(shrinkPStat(80, 8), 80);

console.log("stat-engine.test.ts: all passed");
