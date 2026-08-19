import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import {
  INTEGRITY_TOLERANCE,
  SCORE_GRID_CAP,
  TAIL_MASS_TOLERANCE,
} from "./config";

export type IntegrityCheck = {
  code: string;
  ok: boolean;
  detail?: string;
  affectedFamilies?: string[];
};

export type IntegrityGateResult = {
  passed: boolean;
  checks: IntegrityCheck[];
  suppressedFamilies: Set<string>;
  tailMass: number;
};

function gridSum(grid: number[][]): number {
  let s = 0;
  for (const row of grid) {
    for (const p of row) s += p;
  }
  return s;
}

function tailMass(grid: number[][]): number {
  const k = grid.length - 1;
  let edge = 0;
  for (let i = 0; i <= k; i++) {
    edge += grid[k][i] ?? 0;
    edge += grid[i][k] ?? 0;
  }
  edge -= grid[k][k] ?? 0;
  return Math.max(0, edge);
}

export function runIntegrityGate(
  cfe: CanonicalFixtureEstimate
): IntegrityGateResult {
  const checks: IntegrityCheck[] = [];
  const suppressed = new Set<string>();
  const grid = cfe.score_matrix;
  const m = cfe.markets;

  const sum = gridSum(grid);
  const sumOk = Math.abs(sum - 1) <= INTEGRITY_TOLERANCE;
  checks.push({
    code: "score_grid_sum",
    ok: sumOk,
    detail: `sum=${sum}`,
    affectedFamilies: sumOk ? undefined : ["ALL"],
  });
  if (!sumOk) suppressed.add("ALL");

  const tail = tailMass(grid);
  const tailOk = tail <= TAIL_MASS_TOLERANCE;
  checks.push({
    code: "tail_mass",
    ok: tailOk,
    detail: `tail=${tail.toFixed(6)} cap=${SCORE_GRID_CAP}`,
  });

  const oneX2Sum = m.home + m.draw + m.away;
  const oneX2Ok = Math.abs(oneX2Sum - 1) <= 1e-6;
  checks.push({
    code: "1x2_sum",
    ok: oneX2Ok,
    detail: `sum=${oneX2Sum}`,
    affectedFamilies: oneX2Ok ? undefined : ["RESULT_1X2", "DOUBLE_CHANCE"],
  });
  if (!oneX2Ok) {
    suppressed.add("RESULT_1X2");
    suppressed.add("DOUBLE_CHANCE");
  }

  const ou25Ok = Math.abs(m.over25 + m.under25 - 1) <= 1e-6;
  checks.push({
    code: "ou_2_5",
    ok: ou25Ok,
    affectedFamilies: ou25Ok ? undefined : ["TOTALS"],
  });
  if (!ou25Ok) suppressed.add("TOTALS");

  const bttsOk = Math.abs(m.bttsYes + m.bttsNo - 1) <= 1e-6;
  checks.push({
    code: "btts_sum",
    ok: bttsOk,
    affectedFamilies: bttsOk ? undefined : ["BTTS"],
  });
  if (!bttsOk) suppressed.add("BTTS");

  const dcOk =
    Math.abs(m.home + m.draw - m.doubleChance.oneX) <= 1e-6 &&
    Math.abs(m.away + m.draw - m.doubleChance.xTwo) <= 1e-6 &&
    Math.abs(m.home + m.away - m.doubleChance.oneTwo) <= 1e-6;
  checks.push({
    code: "double_chance_identity",
    ok: dcOk,
    affectedFamilies: dcOk ? undefined : ["DOUBLE_CHANCE"],
  });
  if (!dcOk) suppressed.add("DOUBLE_CHANCE");

  const halfOk =
    Math.abs(m.p1h + m.p2h + m.pTie - 1) <= 1e-6 && cfe.diagnostics.halfSumOk;
  checks.push({
    code: "half_structure_sum",
    ok: halfOk,
    affectedFamilies: halfOk
      ? undefined
      : ["HALF_GOALS", "HSH", "HT_RESULT", "DIEH", "WIN_ONE_HALF"],
  });
  if (!halfOk) {
    for (const f of [
      "HALF_GOALS",
      "HSH",
      "HT_RESULT",
      "DIEH",
      "WIN_ONE_HALF",
    ]) {
      suppressed.add(f);
    }
  }

  const passed =
    sumOk && oneX2Ok && ou25Ok && bttsOk && dcOk && tailOk;

  return {
    passed,
    checks,
    suppressedFamilies: suppressed,
    tailMass: tail,
  };
}
