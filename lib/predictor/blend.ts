import type { Market1x2Probs } from "./odds";

function clamp(p: number, lo = 0.001, hi = 0.999): number {
  return Math.min(hi, Math.max(lo, p));
}

export function blend1x2(
  model: [number, number, number],
  market: Market1x2Probs,
  alpha: number
): [number, number, number] {
  const a = clamp(alpha, 0, 1);
  const blended: [number, number, number] = [
    a * model[0] + (1 - a) * market.pHome,
    a * model[1] + (1 - a) * market.pDraw,
    a * model[2] + (1 - a) * market.pAway,
  ];
  const sum = blended[0] + blended[1] + blended[2];
  if (sum <= 0) return model;
  return [blended[0] / sum, blended[1] / sum, blended[2] / sum];
}

export function blendBinary(modelOver: number, marketOver: number, alpha: number): number {
  const a = clamp(alpha, 0, 1);
  return clamp(a * modelOver + (1 - a) * marketOver);
}
