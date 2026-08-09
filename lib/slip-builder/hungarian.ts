/**
 * Kuhn–Munkres (Hungarian) algorithm for maximum-weight assignment.
 * Cost matrix is converted to maximization via negation of scores.
 * Returns column assignment for each row (or -1 if unmatched).
 */

export function hungarianMaximize(score: number[][]): number[] {
  const nRows = score.length;
  if (nRows === 0) return [];
  const nCols = Math.max(...score.map((r) => r.length), 0);
  if (nCols === 0) return Array(nRows).fill(-1);

  const n = Math.max(nRows, nCols);
  // Pad to square; missing cells get very low score
  const NEG = -1e12;
  const a: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (i < nRows && j < score[i]!.length) return score[i]![j]!;
      return NEG;
    })
  );

  // Convert maximize → minimize by negating
  const u = Array(n + 1).fill(0) as number[];
  const v = Array(n + 1).fill(0) as number[];
  const p = Array(n + 1).fill(0) as number[];
  const way = Array(n + 1).fill(0) as number[];

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(n + 1).fill(Infinity) as number[];
    const used = Array(n + 1).fill(false) as boolean[];
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = -a[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]!]! += delta;
          v[j]! -= delta;
        } else {
          minv[j]! -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = Array(nRows).fill(-1) as number[];
  for (let j = 1; j <= n; j++) {
    const i = p[j]! - 1;
    const col = j - 1;
    if (i >= 0 && i < nRows && col < nCols && a[i]![col]! > NEG / 2) {
      assignment[i] = col;
    }
  }
  return assignment;
}
