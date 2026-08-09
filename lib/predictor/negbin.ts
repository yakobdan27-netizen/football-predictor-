/**
 * Negative Binomial PMF for overdispersed counts (corners).
 * Parameterization: mean μ, dispersion φ = Var/Mean (>1).
 * Success probability p = 1/φ, r = μ/(φ-1).
 */

export function negBinPmf(k: number, mu: number, dispersion: number): number {
  const phi = Math.max(1.01, dispersion);
  const mean = Math.max(1e-6, mu);
  const r = mean / (phi - 1);
  const p = 1 / phi;
  if (k < 0 || !Number.isFinite(k)) return 0;
  // P(K=k) = C(k+r-1, k) * (1-p)^k * p^r
  let logP = r * Math.log(p) + k * Math.log(1 - p);
  // log Gamma(k+r) - log Gamma(r) - log Gamma(k+1)
  logP += logGamma(k + r) - logGamma(r) - logGamma(k + 1);
  return Math.exp(logP);
}

function logGamma(x: number): number {
  // Lanczos approximation for x > 0
  if (x <= 0) return Infinity;
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843696540789e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let a = c[0]!;
  for (let i = 1; i < g + 2; i++) a += c[i]! / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** P(X > line), P(X < line), P(X == floor(line)) for whole/half lines. */
export function negBinOverUnderPush(
  line: number,
  mu: number,
  dispersion: number,
  maxK = 40
): { over: number; under: number; push: number } {
  const isWhole = Number.isInteger(line);
  let over = 0;
  let under = 0;
  let push = 0;
  for (let k = 0; k <= maxK; k++) {
    const p = negBinPmf(k, mu, dispersion);
    if (isWhole && k === line) push += p;
    else if (k > line) over += p;
    else under += p;
  }
  const total = over + under + push;
  if (total <= 0) return { over: 0, under: 1, push: 0 };
  return {
    over: over / total,
    under: under / total,
    push: push / total,
  };
}
