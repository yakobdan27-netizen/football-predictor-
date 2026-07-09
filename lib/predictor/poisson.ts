export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

export function poissonLogPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 0 : -Infinity;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return logP;
}

export function poissonCdf(k: number, lambda: number): number {
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += poissonPmf(i, lambda);
  return sum;
}

export function outer(a: number[], b: number[]): number[][] {
  return a.map((ai) => b.map((bj) => ai * bj));
}

export function sumMatrix(m: number[][]): number {
  return m.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
}

export function trilSum(m: number[][], offset = 0): number {
  let s = 0;
  for (let i = 0; i < m.length; i++)
    for (let j = 0; j < m[i].length; j++)
      if (i - j > offset) s += m[i][j];
  return s;
}

export function triuSum(m: number[][], offset = 0): number {
  let s = 0;
  for (let i = 0; i < m.length; i++)
    for (let j = 0; j < m[i].length; j++)
      if (j - i > offset) s += m[i][j];
  return s;
}

export function trace(m: number[][]): number {
  return m.reduce((s, row, i) => s + row[i], 0);
}

export function overUnderFromPmf(pmf: number[], line: number): [number, number] {
  const k = Math.floor(line);
  const pUnder = pmf.slice(0, k + 1).reduce((a, b) => a + b, 0);
  return [1 - pUnder, pUnder];
}

/** O/U for sum of two independent Poisson counts (e.g. total corners). */
export function overUnderFromPoissonSum(
  lambdaA: number,
  lambdaB: number,
  line: number,
  maxTotal = 30
): [number, number] {
  const pmfA = Array.from({ length: maxTotal + 1 }, (_, i) => poissonPmf(i, lambdaA));
  const pmfB = Array.from({ length: maxTotal + 1 }, (_, i) => poissonPmf(i, lambdaB));
  const pmfTotal = Array(2 * maxTotal + 1).fill(0);
  for (let i = 0; i <= maxTotal; i++) {
    for (let j = 0; j <= maxTotal; j++) {
      pmfTotal[i + j] += pmfA[i] * pmfB[j];
    }
  }
  return overUnderFromPmf(pmfTotal, line);
}
