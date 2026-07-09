import assert from "node:assert/strict";
import { buildScoreMatrix } from "@/lib/predictor/score-matrix";
import {
  analyzeCorrectScore,
  capGridAtSix,
  compareWeakestByConcentration,
  fairOdds,
  rankActualScore,
  analysisToSnapshot,
  formatScoreline,
} from "./correct-score";
import { validateMatchLeg } from "./match-entry-helpers";
import type { LogMatch } from "./types";

const grid = buildScoreMatrix(1.4, 1.1, -0.13, 8);
const capped = capGridAtSix(grid);
assert.ok(capped.capped.length === 7);
assert.ok(capped.otherProb >= 0);
const cappedSum =
  capped.capped.flat().reduce((a, b) => a + b, 0) + capped.otherProb;
assert.ok(Math.abs(cappedSum - capped.totalProb) < 0.001);

const analysis = analyzeCorrectScore(grid);
assert.ok(analysis);
assert.equal(analysis.top6.length, 6);
assert.ok(analysis.top6[0]!.probPct >= analysis.top6[1]!.probPct);
assert.ok(analysis.concentrationIndex > 0);
assert.equal(
  analysis.concentrationIndex,
  Math.round(analysis.top6.slice(0, 3).reduce((s, e) => s + e.probPct, 0) * 10) / 10
);

const top = analysis.top6[0]!;
assert.equal(fairOdds(top.probPct), Math.round((100 / top.probPct) * 100) / 100);

const snapshot = analysisToSnapshot(analysis!);
assert.equal(rankActualScore(snapshot, top.home, top.away), "top1");
if (analysis.top6[1]) {
  assert.equal(
    rankActualScore(snapshot, analysis.top6[1].home, analysis.top6[1].away),
    "top3"
  );
}
assert.equal(rankActualScore(snapshot, 6, 6), "outside");

assert.ok(compareWeakestByConcentration(50, 50, 20, 35) < 0);
assert.ok(compareWeakestByConcentration(40, 50, 20, 35) < 0);

const baseMatch: LogMatch = {
  id: "m1",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  predictions: { "1x2": { prediction: "home", confidence: 60, odds: 1.9 } },
  actualResults: {},
  scored: {},
  correctScorePick: { home: 2, away: 1, odds: 8 },
};
assert.equal(validateMatchLeg(baseMatch), null);

console.log("correct-score.test.ts: all assertions passed");
