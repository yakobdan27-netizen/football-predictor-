import {
  outer,
  overUnderFromPmf,
  poissonPmf,
  trace,
  trilSum,
  triuSum,
} from "./poisson";

export interface DixonColesModelLike {
  attack: Record<string, number>;
  defence: Record<string, number>;
  homeAdv: number;
  rho: number;
}

export function tau(hg: number, ag: number, lam: number, mu: number, rho: number): number {
  if (hg === 0 && ag === 0) return Math.max(1 - lam * mu * rho, 1e-9);
  if (hg === 0 && ag === 1) return Math.max(1 + lam * rho, 1e-9);
  if (hg === 1 && ag === 0) return Math.max(1 + mu * rho, 1e-9);
  if (hg === 1 && ag === 1) return Math.max(1 - rho, 1e-9);
  return 1;
}

export function buildScoreMatrix(
  lambdaHome: number,
  lambdaAway: number,
  rho: number,
  maxGoals = 10
): number[][] {
  const lam = Math.max(lambdaHome, 0.01);
  const mu = Math.max(lambdaAway, 0.01);
  const gh = Array.from({ length: maxGoals + 1 }, (_, i) => i);
  const m = outer(
    gh.map((g) => poissonPmf(g, lam)),
    gh.map((g) => poissonPmf(g, mu))
  );
  m[0]![0]! *= tau(0, 0, lam, mu, rho);
  m[0]![1]! *= tau(0, 1, lam, mu, rho);
  m[1]![0]! *= tau(1, 0, lam, mu, rho);
  m[1]![1]! *= tau(1, 1, lam, mu, rho);
  const total = m.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
  return m.map((row) => row.map((v) => (total > 0 ? v / total : 0)));
}

export function scoreMatrixFromModel(
  model: DixonColesModelLike,
  home: string,
  away: string,
  maxGoals = 10
): number[][] {
  const lam = Math.exp(model.homeAdv + model.attack[home]! - model.defence[away]!);
  const mu = Math.exp(model.attack[away]! - model.defence[home]!);
  return buildScoreMatrix(lam, mu, model.rho, maxGoals);
}

export function totalGoalsPmf(m: number[][]): number[] {
  const maxTotal = 2 * (m.length - 1);
  const pmf = Array(maxTotal + 1).fill(0);
  for (let h = 0; h < m.length; h++) {
    for (let a = 0; a < m[h]!.length; a++) {
      pmf[h + a]! += m[h]![a]!;
    }
  }
  return pmf;
}

export function homeGoalsPmf(m: number[][]): number[] {
  const pmf = Array(m.length).fill(0);
  for (let h = 0; h < m.length; h++) {
    for (let a = 0; a < m[h]!.length; a++) {
      pmf[h]! += m[h]![a]!;
    }
  }
  return pmf;
}

export function awayGoalsPmf(m: number[][]): number[] {
  const pmf = Array(m[0]!.length).fill(0);
  for (let h = 0; h < m.length; h++) {
    for (let a = 0; a < m[h]!.length; a++) {
      pmf[a]! += m[h]![a]!;
    }
  }
  return pmf;
}

export function bttsFromMatrix(m: number[][]): { yes: number; no: number } {
  let yes = 0;
  for (let h = 1; h < m.length; h++) {
    for (let a = 1; a < m[h]!.length; a++) {
      yes += m[h]![a]!;
    }
  }
  return { yes, no: 1 - yes };
}

export function outcomeProbsFromMatrix(m: number[][]): {
  home: number;
  draw: number;
  away: number;
} {
  return {
    home: trilSum(m, -1),
    draw: trace(m),
    away: triuSum(m, 1),
  };
}

export function overUnderFromMatrix(m: number[][], line: number): [number, number] {
  return overUnderFromPmf(totalGoalsPmf(m), line);
}

export function jointProbFromGrid(
  grid: number[][],
  predicate: (h: number, a: number) => boolean
): number {
  let sum = 0;
  for (let h = 0; h < grid.length; h++) {
    for (let a = 0; a < grid[h]!.length; a++) {
      if (predicate(h, a)) sum += grid[h]![a]!;
    }
  }
  return sum;
}

export function jointProbPercent(
  grid: number[][],
  predicate: (h: number, a: number) => boolean
): number {
  return Math.round(jointProbFromGrid(grid, predicate) * 100);
}

export interface MatrixMarketProbs {
  home: number;
  draw: number;
  away: number;
  bttsYes: number;
  bttsNo: number;
  overUnder: Record<string, { over: number; under: number }>;
  doubleChance: { oneX: number; xTwo: number; oneTwo: number };
}

export function marketProbsFromMatrix(
  m: number[][],
  ouLines: number[] = [1.5, 2.5, 3.5]
): MatrixMarketProbs {
  const { home, draw, away } = outcomeProbsFromMatrix(m);
  const btts = bttsFromMatrix(m);
  const overUnder: Record<string, { over: number; under: number }> = {};
  for (const line of ouLines) {
    const [over, under] = overUnderFromMatrix(m, line);
    overUnder[String(line)] = { over, under };
  }
  return {
    home,
    draw,
    away,
    bttsYes: btts.yes,
    bttsNo: btts.no,
    overUnder,
    doubleChance: {
      oneX: home + draw,
      xTwo: draw + away,
      oneTwo: home + away,
    },
  };
}

export function moreGoalsHalfFromMatrices(
  mHt: number[][],
  mSh: number[][]
): { firstHalf: number; secondHalf: number; equal: number } {
  const pmf1 = totalGoalsPmf(mHt);
  const pmf2 = totalGoalsPmf(mSh);
  let firstHalf = 0;
  let secondHalf = 0;
  let equal = 0;
  for (let i = 0; i < pmf1.length; i++) {
    for (let j = 0; j < pmf2.length; j++) {
      const p = pmf1[i]! * pmf2[j]!;
      if (i > j) firstHalf += p;
      else if (j > i) secondHalf += p;
      else equal += p;
    }
  }
  return { firstHalf, secondHalf, equal };
}
