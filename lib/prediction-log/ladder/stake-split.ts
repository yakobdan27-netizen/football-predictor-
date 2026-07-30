/**
 * Suggested declining stake split weighted toward safer (higher hit-rate) rounds.
 * Suggestion only — never enforced.
 */
import { STAKE_EPS } from "./config";
import type { LadderRound } from "./build-ladder";

/**
 * Weight ∝ 1 / max(combined_prob, ε). Missing combined_prob uses ε (treated as high risk → lower weight).
 * Safer rounds (higher combined_prob, fewer legs) get more stake via lower product risk.
 * Actually inverse to combined_prob risk means low combined_prob (risky) gets high weight
 * if we use 1/prob — wait, brief says "weighted toward the safer (lower-leg) rounds — e.g. inverse to combined_prob risk".
 *
 * Safer rounds have HIGHER combined_prob. Inverse to risk means more stake on high combined_prob.
 * So weight ∝ combined_prob (or ∝ 1/risk). Using weight ∝ combined_prob favors safer rounds.
 * Brief also says "inverse to combined_prob risk" — risk is low when combined_prob is high,
 * so inverse to risk ≈ proportional to combined_prob.
 *
 * Alternate reading: "inverse to combined_prob" would overweight risky rounds — wrong intent.
 * We weight ∝ combined_prob (safer gets more), with missing → STAKE_EPS.
 */
export function suggestStakeSplit(
  bankroll: number,
  rounds: LadderRound[]
): number[] {
  if (!(bankroll > 0) || rounds.length === 0) {
    return rounds.map(() => 0);
  }

  const weights = rounds.map((r) => {
    if (r.combined_prob != null && Number.isFinite(r.combined_prob) && r.combined_prob > 0) {
      return r.combined_prob;
    }
    return STAKE_EPS;
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    const even = bankroll / rounds.length;
    return rounds.map(() => roundMoney(even));
  }

  const raw = weights.map((w) => (w / sum) * bankroll);
  // Fix rounding so total equals bankroll
  const rounded = raw.map(roundMoney);
  const drift = bankroll - rounded.reduce((a, b) => a + b, 0);
  if (rounded.length > 0) {
    rounded[rounded.length - 1] = roundMoney(rounded[rounded.length - 1]! + drift);
  }
  return rounded;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}
