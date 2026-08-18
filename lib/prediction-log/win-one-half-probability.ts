/**
 * Win at least one half — independent 1H/2H Poisson halves from CFE λ splits.
 */
import { poissonPmf } from "@/lib/predictor/poisson";

const GRID_MAX = 8;

function jointHalfProb(
  lambdaHome1h: number,
  lambdaAway1h: number,
  lambdaHome2h: number,
  lambdaAway2h: number,
  predicate: (h1: number, a1: number, h2: number, a2: number) => boolean
): number {
  let total = 0;
  const lh1 = Math.max(lambdaHome1h, 1e-9);
  const la1 = Math.max(lambdaAway1h, 1e-9);
  const lh2 = Math.max(lambdaHome2h, 1e-9);
  const la2 = Math.max(lambdaAway2h, 1e-9);

  for (let h1 = 0; h1 <= GRID_MAX; h1++) {
    const pH1 = poissonPmf(h1, lh1);
    for (let a1 = 0; a1 <= GRID_MAX; a1++) {
      const pHt = pH1 * poissonPmf(a1, la1);
      for (let h2 = 0; h2 <= GRID_MAX; h2++) {
        const pH2 = poissonPmf(h2, lh2);
        for (let a2 = 0; a2 <= GRID_MAX; a2++) {
          if (predicate(h1, a1, h2, a2)) {
            total += pHt * pH2 * poissonPmf(a2, la2);
          }
        }
      }
    }
  }
  return Math.min(1, Math.max(0, total));
}

/** P(home or away wins at least one half). */
export function winOneHalfProb(
  lambdaHome1h: number,
  lambdaAway1h: number,
  lambdaHome2h: number,
  lambdaAway2h: number,
  side: "home" | "away"
): number {
  return jointHalfProb(
    lambdaHome1h,
    lambdaAway1h,
    lambdaHome2h,
    lambdaAway2h,
    (h1, a1, h2, a2) => {
      if (side === "home") return h1 > a1 || h2 > a2;
      return a1 > h1 || a2 > h2;
    }
  );
}
