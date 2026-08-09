import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildScoreMatrix,
  jointProbFromGrid,
  outcomeProbsFromMatrix,
} from "@/lib/predictor/score-matrix";
import { comboGridProbabilityPercent } from "@/lib/prediction-log/combo-markets-config";
import { resolveCfeLegProbability } from "@/lib/prediction-log/cfe-leg-probability";
import type { CfeLegEstimateSlice } from "@/lib/prediction-log/cfe-leg-probability";

describe("COMBO joint vs product (test 13)", () => {
  it("joint P(1X & Over 1.5) exceeds product of marginals", () => {
    const grid = buildScoreMatrix(1.8, 1.2, -0.13, 8);
    const o = outcomeProbsFromMatrix(grid);
    const p1x = o.home + o.draw;
    const pOver15 = jointProbFromGrid(grid, (h, a) => h + a > 1.5);
    const product = p1x * pOver15;
    const jointPct = comboGridProbabilityPercent("1x_over_1_5", { grid });
    assert.ok(jointPct != null);
    const joint = jointPct! / 100;
    assert.ok(
      joint > product + 1e-6,
      `expected joint ${joint} > product ${product}`
    );

    const est: CfeLegEstimateSlice = {
      lambdas: {
        home: 1.8,
        away: 1.2,
        home_1h: 0.8,
        away_1h: 0.5,
        home_2h: 1.0,
        away_2h: 0.7,
        home_corners: 5,
        away_corners: 4,
      },
      score_matrix: grid,
      markets: {
        home: o.home,
        draw: o.draw,
        away: o.away,
        bttsYes: 0.5,
        bttsNo: 0.5,
        over25: 0.5,
        under25: 0.5,
        p1h: 0.3,
        p2h: 0.4,
        pTie: 0.3,
        p2h_gt_1h: 0.4,
        cornersOver95: 0.5,
        cornersUnder95: 0.5,
        doubleChance: {
          oneX: p1x,
          xTwo: o.away + o.draw,
          oneTwo: o.home + o.away,
        },
        dieh: { status: "ok", diehYes: 0.5, diehNo: 0.5 },
        totalGoals: {
          lines: {
            0.5: { over: 0.9, under: 0.1 },
            1.5: { over: pOver15, under: 1 - pOver15 },
            2.5: { over: 0.5, under: 0.5 },
            3.5: { over: 0.3, under: 0.7 },
            4.5: { over: 0.15, under: 0.85 },
            5.5: { over: 0.08, under: 0.92 },
            6.5: { over: 0.03, under: 0.97 },
          },
        },
      },
      provenance: { ess: 200, matches_used: 200 },
      rho: -0.13,
    };

    const viaCanon = resolveCfeLegProbability({
      estimate: est,
      family: "COMBO",
      selectionKey: "1x_over_1_5",
      comboId: "1x_over_1_5",
    });
    assert.equal(viaCanon.available, true);
    assert.ok(Math.abs(viaCanon.prob - joint) < 1e-9);
    assert.ok(viaCanon.prob > product);
  });
});
