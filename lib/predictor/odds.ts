export interface Market1x2Probs {
  pHome: number;
  pDraw: number;
  pAway: number;
}

export interface MarketBinaryProbs {
  over: number;
  under: number;
}

export interface B365Odds {
  home: number;
  draw: number;
  away: number;
  over25?: number;
  under25?: number;
}

export function impliedProb(odds: number): number | null {
  if (!Number.isFinite(odds) || odds <= 1) return null;
  return 1 / odds;
}

/** Proportional de-vig: normalize implied probabilities to sum to 1. */
export function deVig1x2(h: number, d: number, a: number): Market1x2Probs | null {
  const ih = impliedProb(h);
  const id = impliedProb(d);
  const ia = impliedProb(a);
  if (ih == null || id == null || ia == null) return null;
  const sum = ih + id + ia;
  if (sum <= 0) return null;
  return { pHome: ih / sum, pDraw: id / sum, pAway: ia / sum };
}

export function deVigBinary(over: number, under: number): MarketBinaryProbs | null {
  const io = impliedProb(over);
  const iu = impliedProb(under);
  if (io == null || iu == null) return null;
  const sum = io + iu;
  if (sum <= 0) return null;
  return { over: io / sum, under: iu / sum };
}

export function marketFromB365(odds: B365Odds): {
  oneX2: Market1x2Probs | null;
  over25: MarketBinaryProbs | null;
} {
  const oneX2 = deVig1x2(odds.home, odds.draw, odds.away);
  const over25 =
    odds.over25 != null && odds.under25 != null
      ? deVigBinary(odds.over25, odds.under25)
      : null;
  return { oneX2, over25 };
}
