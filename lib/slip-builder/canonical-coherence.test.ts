import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildScoreMatrix, outcomeProbsFromMatrix } from "@/lib/predictor/score-matrix";
import { canonicalProbability } from "@/lib/prediction-log/canonical-probability";
import type { CfeLegEstimateSlice } from "@/lib/prediction-log/cfe-leg-probability";
import { scoreLegFromCanonical } from "./canonical-leg";

function est(): CfeLegEstimateSlice {
  const grid = buildScoreMatrix(1.5, 1.2, -0.13, 8);
  const o = outcomeProbsFromMatrix(grid);
  return {
    lambdas: {
      home: 1.5,
      away: 1.2,
      home_1h: 0.67,
      away_1h: 0.54,
      home_2h: 0.83,
      away_2h: 0.66,
      home_corners: 5,
      away_corners: 4.5,
    },
    score_matrix: grid,
    markets: {
      home: o.home,
      draw: o.draw,
      away: o.away,
      bttsYes: 0.52,
      bttsNo: 0.48,
      over25: 0.55,
      under25: 0.45,
      p1h: 0.32,
      p2h: 0.41,
      pTie: 0.27,
      p2h_gt_1h: 0.41,
      cornersOver95: 0.58,
      cornersUnder95: 0.42,
      doubleChance: {
        oneX: o.home + o.draw,
        xTwo: o.away + o.draw,
        oneTwo: o.home + o.away,
      },
      dieh: { status: "ok", diehYes: 0.61, diehNo: 0.39 },
      totalGoals: {
        lines: {
          0.5: { over: 0.9, under: 0.1 },
          1.5: { over: 0.75, under: 0.25 },
          2.5: { over: 0.55, under: 0.45 },
          3.5: { over: 0.35, under: 0.65 },
          4.5: { over: 0.18, under: 0.82 },
          5.5: { over: 0.08, under: 0.92 },
          6.5: { over: 0.03, under: 0.97 },
        },
      },
    },
    provenance: { ess: 150, matches_used: 150 },
    rho: -0.13,
  };
}

describe("canonical coherence (test 9)", () => {
  it("wrapper matches canonicalProbability for RESULT_1X2 and DIEH", () => {
    const estimate = est();
    for (const selectionKey of ["home", "draw", "away"] as const) {
      const direct = canonicalProbability({
        market: "cfe_leg",
        estimate,
        family: "RESULT_1X2",
        selectionKey,
      });
      const via = scoreLegFromCanonical({
        estimate,
        family: "RESULT_1X2",
        selectionKey,
      });
      assert.equal(via.available, true);
      assert.equal(via.pRaw, direct.prob);
    }

    const dieh = canonicalProbability({
      market: "cfe_leg",
      estimate,
      family: "DIEH",
      selectionKey: "yes",
    });
    const viaDieh = scoreLegFromCanonical({
      estimate,
      family: "DIEH",
      selectionKey: "yes",
    });
    assert.equal(viaDieh.pRaw, dieh.prob);
    assert.equal(viaDieh.pRaw, estimate.markets.dieh.diehYes);
  });
});
