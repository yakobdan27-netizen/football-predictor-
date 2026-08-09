/**
 * DIEH calibration backtest — held-out seasons, reliability table + Brier.
 * Pure helpers accept precomputed predictions; DB runner is optional.
 */
import { computeDiehMarkets } from "./dieh-probability";
import type { LeagueHalfParams } from "@/lib/hist/half-params-types";
import {
  deriveHalfGoals,
  fitLeagueHalfParamsFromRows,
  type HalfFixtureRow,
} from "@/lib/hist/fit-half-params";

export type DiehCalibrationBucket = {
  /** Lower edge of predicted band, e.g. 0.40 for 40–45%. */
  bandLo: number;
  bandHi: number;
  n: number;
  predictedMean: number;
  observedRate: number;
};

export type DiehCalibrationReport = {
  n: number;
  brier: number;
  buckets: DiehCalibrationBucket[];
  heldOutSeasons: number[];
  trainN: number;
};

export type DiehBacktestRow = {
  season: number;
  lambdaHome: number;
  lambdaAway: number;
  /** Observed DIEH outcome. */
  observedYes: boolean;
};

/**
 * Fit half params on train seasons only, score held-out fixtures.
 * λ inputs must be supplied externally (brief: consume canonical λ methodology).
 */
export function backtestDiehOnRows(input: {
  trainRows: HalfFixtureRow[];
  testRows: Array<HalfFixtureRow & { lambdaHome: number; lambdaAway: number }>;
  leagueId: number;
  leagueName: string;
  compType: "league" | "cup";
  currentSeason: number;
  heldOutSeasons: number[];
}): DiehCalibrationReport {
  const trainDerived = deriveHalfGoals(input.trainRows, input.currentSeason);
  const params: LeagueHalfParams = fitLeagueHalfParamsFromRows(
    input.leagueId,
    input.leagueName,
    input.compType,
    trainDerived
  );

  const preds: Array<{ p: number; y: number }> = [];
  for (const row of input.testRows) {
    const derived = deriveHalfGoals([row], input.currentSeason);
    if (derived.length === 0) continue;
    const d = derived[0]!;
    const markets = computeDiehMarkets({
      lambdaHome: row.lambdaHome,
      lambdaAway: row.lambdaAway,
      halfParams: params,
    });
    if (markets.status !== "ok" || markets.diehYes == null) continue;
    preds.push({
      p: markets.diehYes,
      y: d.d1 || d.d2 ? 1 : 0,
    });
  }

  const n = preds.length;
  let brier = 0;
  for (const r of preds) {
    brier += (r.p - r.y) ** 2;
  }
  brier = n > 0 ? brier / n : 0;

  const buckets: DiehCalibrationBucket[] = [];
  for (let lo = 0; lo < 1; lo += 0.05) {
    const hi = Math.min(1, lo + 0.05);
    const inBand = preds.filter((r) =>
      hi >= 1 - 1e-12
        ? r.p >= lo && r.p <= 1
        : r.p >= lo && r.p < hi
    );
    if (inBand.length === 0) {
      buckets.push({
        bandLo: lo,
        bandHi: hi,
        n: 0,
        predictedMean: (lo + hi) / 2,
        observedRate: NaN,
      });
      continue;
    }
    const predictedMean =
      inBand.reduce((s, r) => s + r.p, 0) / inBand.length;
    const observedRate =
      inBand.reduce((s, r) => s + r.y, 0) / inBand.length;
    buckets.push({
      bandLo: lo,
      bandHi: hi,
      n: inBand.length,
      predictedMean,
      observedRate,
    });
  }

  return {
    n,
    brier,
    buckets,
    heldOutSeasons: input.heldOutSeasons,
    trainN: trainDerived.length,
  };
}

/** Format reliability table for UI. */
export function formatCalibrationTable(
  report: DiehCalibrationReport
): Array<{
  band: string;
  n: number;
  predicted: string;
  observed: string;
}> {
  return report.buckets
    .filter((b) => b.n > 0)
    .map((b) => ({
      band: `${Math.round(b.bandLo * 100)}–${Math.round(b.bandHi * 100)}%`,
      n: b.n,
      predicted: `${(b.predictedMean * 100).toFixed(1)}%`,
      observed: Number.isFinite(b.observedRate)
        ? `${(b.observedRate * 100).toFixed(1)}%`
        : "—",
    }));
}
