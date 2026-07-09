/** Numerical optimizer (L-BFGS-style gradient descent with finite differences). */

export function minimize(
  fn: (x: number[]) => number,
  x0: number[],
  maxIter = 500,
  tol = 1e-6
): number[] {
  let x = [...x0];
  const n = x.length;
  const eps = 1e-8;
  const history: number[][] = [];
  const gradHistory: number[][] = [];

  function grad(x: number[]): number[] {
    const g = new Array(n).fill(0);
    const f0 = fn(x);
    for (let i = 0; i < n; i++) {
      const xp = [...x];
      xp[i] += eps;
      g[i] = (fn(xp) - f0) / eps;
    }
    return g;
  }

  function dot(a: number[], b: number[]): number {
    return a.reduce((s, v, i) => s + v * b[i], 0);
  }

  function scale(v: number[], s: number): number[] {
    return v.map((x) => x * s);
  }

  function add(a: number[], b: number[]): number[] {
    return a.map((v, i) => v + b[i]);
  }

  function sub(a: number[], b: number[]): number[] {
    return a.map((v, i) => v - b[i]);
  }

  let g = grad(x);
  let fPrev = fn(x);

  for (let iter = 0; iter < maxIter; iter++) {
    const gNorm = Math.sqrt(dot(g, g));
    if (gNorm < tol) break;

    let direction: number[];
    if (history.length === 0) {
      direction = scale(g, -1);
    } else {
      const s = sub(x, history[history.length - 1]);
      const y = sub(g, gradHistory[gradHistory.length - 1]);
      const sy = dot(s, y);
      if (Math.abs(sy) < 1e-12) {
        direction = scale(g, -1);
      } else {
        const rho = 1 / sy;
        let q = [...g];
        for (let i = history.length - 1; i >= 0; i--) {
          const si = sub(x, history[i]);
          const yi = sub(g, gradHistory[i]);
          const alpha = rho * dot(si, q);
          q = sub(q, scale(yi, alpha));
        }
        const gamma = dot(sub(x, history[history.length - 1]), sub(g, gradHistory[gradHistory.length - 1])) /
          dot(sub(g, gradHistory[gradHistory.length - 1]), sub(g, gradHistory[gradHistory.length - 1]));
        let r = scale(q, isFinite(gamma) && gamma > 0 ? gamma : 1);
        for (let i = 0; i < history.length; i++) {
          const si = sub(x, history[i]);
          const yi = sub(g, gradHistory[i]);
          const beta = rho * dot(yi, r);
          r = add(r, scale(si, dot(si, g) - beta));
        }
        direction = scale(r, -1);
      }
    }

    history.push([...x]);
    gradHistory.push([...g]);

    let alpha = 1.0;
    let fNew = fn(x);
    const xOld = [...x];
    for (let ls = 0; ls < 20; ls++) {
      const xTry = add(xOld, scale(direction, alpha));
      fNew = fn(xTry);
      if (fNew < fPrev - 1e-4 * alpha * dot(g, direction)) {
        x = xTry;
        break;
      }
      alpha *= 0.5;
    }

    if (Math.abs(fPrev - fNew) < tol) break;
    fPrev = fNew;
    g = grad(x);

    if (history.length > 10) {
      history.shift();
      gradHistory.shift();
    }
  }

  return x;
}

export function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function center(arr: number[]): number[] {
  const m = mean(arr);
  return arr.map((v) => v - m);
}
