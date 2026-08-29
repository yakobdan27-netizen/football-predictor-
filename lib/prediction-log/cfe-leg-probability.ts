/**
 * Resolve occurrence probability for a slip-builder leg from a CFE slice.
 * Never multiplies marginals for COMBO — always joint grid summation.
 */
import {
  canonicalHomeHandicapLine,
  halfTimeScoreGrid,
} from "@/lib/prediction-log/handicap";
import {
  resolveHandicapProbability,
  type HandicapHistRow,
} from "@/lib/prediction-log/handicap-empirical";
import {
  comboGridProbabilityPercent,
  goalBothHalvesProbabilityPercent,
} from "@/lib/prediction-log/combo-markets-config";
import { poissonOverLine } from "@/lib/prediction-log/poisson-ou";
import {
  awayGoalsPmf,
  homeGoalsPmf,
  jointProbFromGrid,
  outcomeProbsFromMatrix,
} from "@/lib/predictor/score-matrix";
import { overUnderFromPmf } from "@/lib/predictor/poisson";
import { winOneHalfProb } from "@/lib/prediction-log/win-one-half-probability";
import type { SotMarkets } from "@/lib/prediction-log/sot-model";
import type { TotalGoalsLine } from "@/lib/prediction-log/total-goals-markets";
import type { MarketFamilyId } from "@/lib/slip-builder/types";

/** Structural CFE slice — avoids circular import with canonical-fixture-estimate. */
export type CfeLegEstimateSlice = {
  lambdas: {
    home: number;
    away: number;
    home_1h: number;
    away_1h: number;
    home_2h: number;
    away_2h: number;
    home_corners: number;
    away_corners: number;
    home_sot?: number;
    away_sot?: number;
  };
  score_matrix: number[][];
  markets: {
    home: number;
    draw: number;
    away: number;
    bttsYes: number;
    bttsNo: number;
    over25: number;
    under25: number;
    p1h: number;
    p2h: number;
    pTie: number;
    p2h_gt_1h: number;
    cornersOver95: number;
    cornersUnder95: number;
    doubleChance: { oneX: number; xTwo: number; oneTwo: number };
    dieh: {
      status: string;
      diehYes: number | null;
      diehNo: number | null;
    };
    totalGoals: {
      lines: Record<number, { over: number; under: number }>;
    };
    sot?: SotMarkets;
  };
  provenance: { ess: number; matches_used: number };
  rho: number;
  /** Finished-score samples for empirical handicap rates. */
  handicapHistRows?: HandicapHistRow[];
};

export type CfeLegResolveResult = {
  prob: number;
  nEffective: number;
  coherenceOk: boolean;
  available: boolean;
  reason?: string;
  handicapSource?: "hist" | "estimated_fallback" | "insufficient";
  handicapN?: number;
  expectedDiff?: number;
  canonicalLine?: number;
};

function ouFromPmf(pmf: number[], line: number, side: "over" | "under"): number {
  const [over, under] = overUnderFromPmf(pmf, line);
  return side === "over" ? over : under;
}

function poissonOverHalf(lambda: number, line: number): number {
  // P(X > line) for Poisson via cumulative PMF on 0..20
  let underOrEq = 0;
  let mass = 0;
  let term = Math.exp(-Math.max(lambda, 1e-9));
  for (let k = 0; k <= 20; k++) {
    if (k > 0) term *= Math.max(lambda, 1e-9) / k;
    mass += term;
    if (k + 1e-12 < line) underOrEq += term;
    else if (Math.abs(k - line) < 1e-12) {
      // push line — treat as neither over nor under for half-goal lines
    }
  }
  const over = Math.max(0, Math.min(1, 1 - underOrEq));
  return over;
}

export function resolveCfeLegProbability(input: {
  estimate: CfeLegEstimateSlice;
  family: MarketFamilyId;
  selectionKey: string;
  line?: number | null;
  comboId?: string | null;
}): CfeLegResolveResult {
  const { estimate: est, family, selectionKey } = input;
  const nEffective = est.provenance.ess || est.provenance.matches_used || 0;
  const grid = est.score_matrix;
  const m = est.markets;

  const ok = (prob: number, coherenceOk = true): CfeLegResolveResult => ({
    prob,
    nEffective,
    coherenceOk,
    available: true,
  });
  const fail = (reason: string): CfeLegResolveResult => ({
    prob: 0,
    nEffective,
    coherenceOk: false,
    available: false,
    reason,
  });

  switch (family) {
    case "RESULT_1X2": {
      const sum = m.home + m.draw + m.away;
      const coherenceOk = Math.abs(sum - 1) < 1e-6;
      if (selectionKey === "home") return ok(m.home, coherenceOk);
      if (selectionKey === "draw") return ok(m.draw, coherenceOk);
      if (selectionKey === "away") return ok(m.away, coherenceOk);
      return fail(`unknown RESULT_1X2 key ${selectionKey}`);
    }
    case "DOUBLE_CHANCE": {
      const oneX = m.home + m.draw;
      const xTwo = m.away + m.draw;
      const twelve = m.home + m.away;
      const dcOk =
        Math.abs(oneX - m.doubleChance.oneX) < 1e-6 &&
        Math.abs(xTwo - m.doubleChance.xTwo) < 1e-6 &&
        Math.abs(twelve - m.doubleChance.oneTwo) < 1e-6;
      if (selectionKey === "1X") return ok(m.doubleChance.oneX, dcOk);
      if (selectionKey === "X2") return ok(m.doubleChance.xTwo, dcOk);
      if (selectionKey === "12") return ok(m.doubleChance.oneTwo, dcOk);
      return fail(`unknown DOUBLE_CHANCE key ${selectionKey}`);
    }
    case "HANDICAP": {
      const line = input.line ?? Number(selectionKey.split("_").slice(1).join("_"));
      if (!Number.isFinite(line)) return fail("handicap line missing");
      const side = selectionKey.startsWith("away") ? "away" : "home";
      const expectedDiff = est.lambdas.home - est.lambdas.away;
      const rows = est.handicapHistRows ?? [];
      const resolved = resolveHandicapProbability({
        rows,
        homeLine: line,
        side,
        grid,
        lambdaHome: est.lambdas.home,
        lambdaAway: est.lambdas.away,
      });
      const nEff = resolved.source === "hist" ? resolved.n : nEffective;
      return {
        prob: resolved.prob,
        nEffective: nEff,
        coherenceOk: true,
        available: true,
        handicapSource: resolved.source,
        handicapN: resolved.n,
        expectedDiff,
        canonicalLine: canonicalHomeHandicapLine(expectedDiff),
      };
    }
    case "TOTALS": {
      const line = (input.line ??
        Number(selectionKey.replace(/^(over|under)_/, ""))) as TotalGoalsLine;
      const side = selectionKey.startsWith("under") ? "under" : "over";
      const row = m.totalGoals.lines[line];
      if (!row) {
        if (line === 2.5) {
          return ok(side === "over" ? m.over25 : m.under25);
        }
        return fail(`totals line ${line} unavailable`);
      }
      const coherenceOk = Math.abs(row.over + row.under - 1) < 1e-6;
      return ok(side === "over" ? row.over : row.under, coherenceOk);
    }
    case "TEAM_GOALS": {
      if (selectionKey === "home_cs") {
        return ok(jointProbFromGrid(grid, (_h, a) => a === 0));
      }
      if (selectionKey === "away_cs") {
        return ok(jointProbFromGrid(grid, (h) => h === 0));
      }
      const homePmf = homeGoalsPmf(grid);
      const awayPmf = awayGoalsPmf(grid);
      const isHome = selectionKey.startsWith("home_");
      const isOver = selectionKey.includes("_over_");
      const line =
        input.line ??
        Number(selectionKey.replace(/^.*(over|under)_/, ""));
      if (!Number.isFinite(line)) return fail("team goals line missing");
      const pmf = isHome ? homePmf : awayPmf;
      return ok(ouFromPmf(pmf, line, isOver ? "over" : "under"));
    }
    case "BTTS": {
      const coherenceOk = Math.abs(m.bttsYes + m.bttsNo - 1) < 1e-6;
      if (selectionKey === "yes") return ok(m.bttsYes, coherenceOk);
      if (selectionKey === "no") return ok(m.bttsNo, coherenceOk);
      return fail(`unknown BTTS key ${selectionKey}`);
    }
    case "HALF_GOALS": {
      if (selectionKey === "2h_gt_1h") return ok(m.p2h_gt_1h);
      if (selectionKey === "1h_gt_2h") return ok(m.p1h);
      if (selectionKey === "tie") return ok(m.pTie);
      if (selectionKey === "goal_both_halves") {
        const pct = goalBothHalvesProbabilityPercent({
          grid,
          lambdaHome: est.lambdas.home,
          lambdaAway: est.lambdas.away,
        });
        if (pct == null) return fail("goal_both_halves unavailable");
        return ok(pct / 100);
      }
      if (selectionKey === "home_1h_over_0_5") {
        return ok(poissonOverHalf(est.lambdas.home_1h, 0.5));
      }
      if (selectionKey === "away_1h_over_0_5") {
        return ok(poissonOverHalf(est.lambdas.away_1h, 0.5));
      }
      return fail(`unknown HALF_GOALS key ${selectionKey}`);
    }
    case "HSH": {
      const sum = m.p1h + m.p2h + m.pTie;
      const coherenceOk = Math.abs(sum - 1) < 1e-5;
      if (selectionKey === "2h_gt_1h") return ok(m.p2h, coherenceOk);
      if (selectionKey === "1h_gt_2h") return ok(m.p1h, coherenceOk);
      if (selectionKey === "tie") return ok(m.pTie, coherenceOk);
      return fail(`unknown HSH key ${selectionKey}`);
    }
    case "HT_RESULT": {
      const ht = halfTimeScoreGrid(est.lambdas.home, est.lambdas.away);
      const o = outcomeProbsFromMatrix(ht);
      if (selectionKey === "ht_home") return ok(o.home);
      if (selectionKey === "ht_draw") return ok(o.draw);
      if (selectionKey === "ht_away") return ok(o.away);
      if (selectionKey === "ht_1X") return ok(o.home + o.draw);
      if (selectionKey === "ht_X2") return ok(o.away + o.draw);
      if (selectionKey === "ht_12") return ok(o.home + o.away);
      return fail(`unknown HT_RESULT key ${selectionKey}`);
    }
    case "DIEH": {
      if (m.dieh.status !== "ok" || m.dieh.diehYes == null || m.dieh.diehNo == null) {
        return fail("DIEH unavailable");
      }
      const coherenceOk = Math.abs(m.dieh.diehYes + m.dieh.diehNo - 1) < 1e-6;
      if (selectionKey === "yes") return ok(m.dieh.diehYes, coherenceOk);
      if (selectionKey === "no") return ok(m.dieh.diehNo, coherenceOk);
      return fail(`unknown DIEH key ${selectionKey}`);
    }
    case "WIN_ONE_HALF": {
      const pHome = winOneHalfProb(
        est.lambdas.home_1h,
        est.lambdas.away_1h,
        est.lambdas.home_2h,
        est.lambdas.away_2h,
        "home"
      );
      const pAway = winOneHalfProb(
        est.lambdas.home_1h,
        est.lambdas.away_1h,
        est.lambdas.home_2h,
        est.lambdas.away_2h,
        "away"
      );
      const coherenceOk = Math.abs(pHome + pAway - 1) < 0.08;
      if (selectionKey === "home") return ok(pHome, coherenceOk);
      if (selectionKey === "away") return ok(pAway, coherenceOk);
      return fail(`unknown WIN_ONE_HALF key ${selectionKey}`);
    }
    case "CORNERS": {
      const coherenceOk =
        Math.abs(m.cornersOver95 + m.cornersUnder95 - 1) < 1e-6;
      if (selectionKey === "over_9_5") return ok(m.cornersOver95, coherenceOk);
      if (selectionKey === "under_9_5") return ok(m.cornersUnder95, coherenceOk);
      const teamCornerMatch = selectionKey.match(
        /^(home|away)_(over|under)_(\d)_(\d)$/
      );
      if (teamCornerMatch) {
        const side = teamCornerMatch[1] as "home" | "away";
        const direction = teamCornerMatch[2] as "over" | "under";
        const line = parseFloat(`${teamCornerMatch[3]}.${teamCornerMatch[4]}`);
        const lambda =
          side === "home" ? est.lambdas.home_corners : est.lambdas.away_corners;
        if (!Number.isFinite(lambda) || lambda <= 0) {
          return fail(`team corners lambda unavailable for ${side}`);
        }
        const pOver = poissonOverLine(line, lambda);
        const pUnder = 1 - pOver;
        const prob = direction === "over" ? pOver : pUnder;
        const pairCoherence = Math.abs(pOver + pUnder - 1) < 1e-6;
        return ok(prob, pairCoherence);
      }
      return fail(`unknown CORNERS key ${selectionKey}`);
    }
    case "SOT": {
      const sot = m.sot;
      if (!sot || sot.status !== "ok") return fail("SOT unavailable");
      const line =
        input.line ??
        Number(selectionKey.replace(/^.*(over|under)_/, ""));
      if (!Number.isFinite(line)) return fail("SOT line missing");

      let row: { over: number; under: number } | undefined;
      if (selectionKey.startsWith("match_")) {
        row = sot.lines.match[line];
      } else if (selectionKey.startsWith("home_")) {
        row = sot.lines.home[line];
      } else if (selectionKey.startsWith("away_")) {
        row = sot.lines.away[line];
      }
      if (!row) return fail(`SOT line ${line} unavailable`);
      const side = selectionKey.includes("_under_") ? "under" : "over";
      const coherenceOk = Math.abs(row.over + row.under - 1) < 1e-6;
      return ok(side === "over" ? row.over : row.under, coherenceOk);
    }
    case "COMBO": {
      const comboId = input.comboId ?? selectionKey;
      const pct = comboGridProbabilityPercent(comboId, {
        grid,
        lambdaHome: est.lambdas.home,
        lambdaAway: est.lambdas.away,
      });
      if (pct == null) return fail(`combo ${comboId} unavailable`);
      return ok(pct / 100);
    }
    default: {
      const _e: never = family;
      return fail(`unknown family ${_e}`);
    }
  }
}
