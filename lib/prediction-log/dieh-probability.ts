/**
 * Draw in Either Half (DIEH) mathematics.
 *
 * Market definition (locked):
 * - YES if first half ends level OR second half (isolated 46–90) ends level.
 * - NOT half-time draw alone; NOT HT/FT draw.
 * - Second-half assessment ignores first-half goals entirely.
 *
 * RULE 0.1 — half λ from empirical shares × FT λ, never λ/2.
 * RULE 0.2 — P(level) = Skellam mass at 0 via diagonal Poisson sum.
 * RULE 0.3 — joint uses empirically measured κ, never blind independence.
 */
import {
  DIEH_MIN_VALID_FIXTURES,
  type LeagueHalfParams,
} from "@/lib/hist/half-params-types";
import { poissonPmf } from "@/lib/predictor/poisson";

const TOL = 1e-9;
const TAIL_TOL = 1e-10;
const DEFAULT_N = 8;

export type HalfLambdas = {
  home1: number;
  away1: number;
  home2: number;
  away2: number;
};

export type DiehMarkets = {
  status: "ok" | "insufficient" | "error";
  nValid: number;
  pD1: number | null;
  pD2: number | null;
  pD1AndD2: number | null;
  diehYes: number | null;
  diehNo: number | null;
  halfLambdas: HalfLambdas | null;
  halfShares: {
    s1Home: number;
    s1Away: number;
    s1Combined: number;
    usedCombinedShareHome: boolean;
    usedCombinedShareAway: boolean;
  } | null;
  kappaAdj: number | null;
  kappaRaw: number | null;
  errorState?: string;
  message?: string;
};

/** P both teams score equally in a half — diagonal sum; raise N if tail ≥ 1e-10. */
export function halfLevelProbability(
  lambdaH: number,
  lambdaA: number,
  opts?: { maxN?: number }
): { p: number; nUsed: number; tailMass: number } {
  const lh = Math.max(0, lambdaH);
  const la = Math.max(0, lambdaA);
  let N = opts?.maxN ?? DEFAULT_N;
  let p = 0;
  let used = 0;

  for (;;) {
    p = 0;
    for (let n = 0; n <= N; n++) {
      p += poissonPmf(n, lh) * poissonPmf(n, la);
    }
    // Tail bound: remaining joint mass on either side above N.
    let homeTail = 0;
    let awayTail = 0;
    // crude but sufficient: 1 - cdf(N)
    let homeCdf = 0;
    let awayCdf = 0;
    for (let n = 0; n <= N; n++) {
      homeCdf += poissonPmf(n, lh);
      awayCdf += poissonPmf(n, la);
    }
    homeTail = Math.max(0, 1 - homeCdf);
    awayTail = Math.max(0, 1 - awayCdf);
    const tailMass = homeTail + awayTail;
    used = N;
    if (tailMass < TAIL_TOL || N >= 40) {
      return { p, nUsed: used, tailMass };
    }
    N += 4;
  }
}

export function computeHalfLambdas(
  lambdaHome: number,
  lambdaAway: number,
  params: Pick<
    LeagueHalfParams,
    "s1Home" | "s1Away" | "usedCombinedShareHome" | "usedCombinedShareAway" | "s1"
  >
): HalfLambdas {
  const s1h = params.usedCombinedShareHome ? params.s1 : params.s1Home;
  const s1a = params.usedCombinedShareAway ? params.s1 : params.s1Away;
  const home1 = lambdaHome * s1h;
  const home2 = lambdaHome * (1 - s1h);
  const away1 = lambdaAway * s1a;
  const away2 = lambdaAway * (1 - s1a);

  if (Math.abs(home1 + home2 - lambdaHome) > TOL) {
    throw new Error(
      `half λ home invariant failed: ${home1}+${home2}≠${lambdaHome}`
    );
  }
  if (Math.abs(away1 + away2 - lambdaAway) > TOL) {
    throw new Error(
      `half λ away invariant failed: ${away1}+${away2}≠${lambdaAway}`
    );
  }
  return { home1, away1, home2, away2 };
}

function checkSanityBounds(
  pD1: number,
  pD2: number,
  pJoint: number,
  pDieh: number
): string | null {
  if (!(pD1 > 0 && pD1 < 1)) return `P(D1)=${pD1} not in (0,1)`;
  if (!(pD2 > 0 && pD2 < 1)) return `P(D2)=${pD2} not in (0,1)`;
  if (pJoint > Math.min(pD1, pD2) + TOL) {
    return `P(D1∩D2)=${pJoint} > min(P(D1),P(D2))`;
  }
  if (pDieh + TOL < Math.max(pD1, pD2)) {
    return `P(DIEH)=${pDieh} < max(P(D1),P(D2))`;
  }
  if (pDieh > pD1 + pD2 + TOL || pDieh > 1 + TOL) {
    return `P(DIEH)=${pDieh} exceeds union / 1 bound`;
  }
  return null;
}

/**
 * Compute DIEH markets from FT λ + fitted half params.
 * Insufficient-data and sanity failures return status without clamping.
 */
export function computeDiehMarkets(input: {
  lambdaHome: number;
  lambdaAway: number;
  halfParams: LeagueHalfParams | null;
}): DiehMarkets {
  const { lambdaHome, lambdaAway, halfParams } = input;
  if (!halfParams || halfParams.nValid < DIEH_MIN_VALID_FIXTURES) {
    const n = halfParams?.nValid ?? 0;
    return {
      status: "insufficient",
      nValid: n,
      pD1: null,
      pD2: null,
      pD1AndD2: null,
      diehYes: null,
      diehNo: null,
      halfLambdas: null,
      halfShares: null,
      kappaAdj: null,
      kappaRaw: null,
      message: `INSUFFICIENT HALF-TIME DATA (n=${n}, need ≥${DIEH_MIN_VALID_FIXTURES})`,
    };
  }

  try {
    const halfLambdas = computeHalfLambdas(lambdaHome, lambdaAway, halfParams);
    const { p: pD1 } = halfLevelProbability(
      halfLambdas.home1,
      halfLambdas.away1
    );
    const { p: pD2 } = halfLevelProbability(
      halfLambdas.home2,
      halfLambdas.away2
    );
    const pD1AndD2 = halfParams.kappaAdj * pD1 * pD2;
    const diehYes = pD1 + pD2 - pD1AndD2;
    const diehNo = 1 - diehYes;

    if (Math.abs(diehYes + diehNo - 1) > TOL) {
      return {
        status: "error",
        nValid: halfParams.nValid,
        pD1,
        pD2,
        pD1AndD2,
        diehYes,
        diehNo,
        halfLambdas,
        halfShares: {
          s1Home: halfParams.s1Home,
          s1Away: halfParams.s1Away,
          s1Combined: halfParams.s1,
          usedCombinedShareHome: halfParams.usedCombinedShareHome,
          usedCombinedShareAway: halfParams.usedCombinedShareAway,
        },
        kappaAdj: halfParams.kappaAdj,
        kappaRaw: halfParams.kappaRaw,
        errorState: `complement sum drift: ${diehYes + diehNo}`,
      };
    }

    const boundErr = checkSanityBounds(pD1, pD2, pD1AndD2, diehYes);
    if (boundErr) {
      return {
        status: "error",
        nValid: halfParams.nValid,
        pD1,
        pD2,
        pD1AndD2,
        diehYes,
        diehNo,
        halfLambdas,
        halfShares: {
          s1Home: halfParams.s1Home,
          s1Away: halfParams.s1Away,
          s1Combined: halfParams.s1,
          usedCombinedShareHome: halfParams.usedCombinedShareHome,
          usedCombinedShareAway: halfParams.usedCombinedShareAway,
        },
        kappaAdj: halfParams.kappaAdj,
        kappaRaw: halfParams.kappaRaw,
        errorState: boundErr,
      };
    }

    return {
      status: "ok",
      nValid: halfParams.nValid,
      pD1,
      pD2,
      pD1AndD2,
      diehYes,
      diehNo,
      halfLambdas,
      halfShares: {
        s1Home: halfParams.s1Home,
        s1Away: halfParams.s1Away,
        s1Combined: halfParams.s1,
        usedCombinedShareHome: halfParams.usedCombinedShareHome,
        usedCombinedShareAway: halfParams.usedCombinedShareAway,
      },
      kappaAdj: halfParams.kappaAdj,
      kappaRaw: halfParams.kappaRaw,
    };
  } catch (e) {
    return {
      status: "error",
      nValid: halfParams.nValid,
      pD1: null,
      pD2: null,
      pD1AndD2: null,
      diehYes: null,
      diehNo: null,
      halfLambdas: null,
      halfShares: null,
      kappaAdj: halfParams.kappaAdj,
      kappaRaw: halfParams.kappaRaw,
      errorState: e instanceof Error ? e.message : String(e),
    };
  }
}
