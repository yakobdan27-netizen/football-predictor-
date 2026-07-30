/**
 * In-play conditioning: when the match is already in the 2H, condition on
 * realized 1H goals and remaining 2H Poisson mean.
 */
import { poissonPmf } from "@/lib/predictor/poisson";
import { POISSON_CAP } from "./config";

export interface LiveHalfConditionInput {
  /** Realized first-half total goals (both teams). */
  realized_1h: number;
  /** Goals already scored in the second half (both teams). */
  goals_2h_so_far: number;
  /** Pre-match expected 2H total (mu_2h_final). */
  mu_2h_final: number;
  /**
   * Elapsed minutes in the second half (0–45+). When set and goals already
   * scored in 2H, remaining mean scales by (1 - elapsed/45).
   * If null/unknown and goals_2h_so_far === 0, use full mu_2h_final.
   */
  elapsed_2h_minutes?: number | null;
  cap?: number;
}

export interface LiveHalfConditionResult {
  p_2h_gt_1h: number;
  p_2h_eq_1h: number;
  p_2h_lt_1h: number;
  mu_2h_remaining: number;
  expected_2h: number;
}

export function remainingMu2h(params: {
  mu_2h_final: number;
  goals_2h_so_far: number;
  elapsed_2h_minutes?: number | null;
}): number {
  const { mu_2h_final, goals_2h_so_far, elapsed_2h_minutes } = params;
  if (goals_2h_so_far <= 0 && (elapsed_2h_minutes == null || elapsed_2h_minutes <= 0)) {
    return Math.max(0, mu_2h_final);
  }
  if (elapsed_2h_minutes != null && Number.isFinite(elapsed_2h_minutes)) {
    const fracLeft = Math.max(0, 1 - Math.min(45, Math.max(0, elapsed_2h_minutes)) / 45);
    return Math.max(0, mu_2h_final * fracLeft);
  }
  // Goals already scored but no minute: leave residual as max(0, mu - observed).
  return Math.max(0, mu_2h_final - goals_2h_so_far);
}

/**
 * P(g2_already + Rem > g1), P(==), P(<) with Rem ~ Poisson(mu_remaining).
 */
export function conditionOnRealized1h(input: LiveHalfConditionInput): LiveHalfConditionResult {
  const g1 = Math.max(0, Math.floor(input.realized_1h));
  const g2SoFar = Math.max(0, Math.floor(input.goals_2h_so_far));
  const cap = input.cap ?? POISSON_CAP;
  const muRem = remainingMu2h({
    mu_2h_final: input.mu_2h_final,
    goals_2h_so_far: g2SoFar,
    elapsed_2h_minutes: input.elapsed_2h_minutes,
  });

  let p_2h_gt_1h = 0;
  let p_2h_eq_1h = 0;
  let p_2h_lt_1h = 0;

  for (let rem = 0; rem <= cap; rem++) {
    const p = poissonPmf(rem, muRem);
    const total2 = g2SoFar + rem;
    if (total2 > g1) p_2h_gt_1h += p;
    else if (total2 === g1) p_2h_eq_1h += p;
    else p_2h_lt_1h += p;
  }

  return {
    p_2h_gt_1h,
    p_2h_eq_1h,
    p_2h_lt_1h,
    mu_2h_remaining: muRem,
    expected_2h: g2SoFar + muRem,
  };
}

/** Status shorts that mean we are past 1H with a fixed 1H total. */
export function isSecondHalfStatus(statusShort: string | null | undefined): boolean {
  const s = (statusShort ?? "").toUpperCase();
  return s === "2H" || s === "ET" || s === "BT" || s === "P" || s === "LIVE";
}
