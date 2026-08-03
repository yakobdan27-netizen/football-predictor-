/**
 * Exact brief formula for P(2H total goals > 1H total goals).
 */
import { poissonPmf } from "@/lib/predictor/poisson";
import { beta2hFor } from "@/lib/hist/beta-cache";
import {
  FORMATION_ADJUST,
  MIN_MATCHES,
  POISSON_CAP,
  RECENCY_DAYS,
  RECENCY_PENALTY,
  leagueTotalFor,
} from "./config";
import type { TeamHalfProfile } from "./types";

export interface HalfMuResult {
  mu_1h: number;
  mu_2h: number;
  mu_2h_tilted: number;
  raw_total: number;
  scale: number;
  mu_1h_final: number;
  mu_2h_final: number;
  usedPriorSplit: boolean;
}

export interface HalfProbResult {
  p_2h_gt_1h: number;
  p_2h_eq_1h: number;
  p_2h_lt_1h: number;
  expected_1h: number;
  expected_2h: number;
}

export function computeHalfMus(
  home: Pick<TeamHalfProfile, "sc_1h" | "sc_2h" | "conc_1h" | "conc_2h">,
  away: Pick<TeamHalfProfile, "sc_1h" | "sc_2h" | "conc_1h" | "conc_2h">,
  league: string,
  formationAdjust: number = FORMATION_ADJUST
): HalfMuResult {
  const mu_1h =
    0.5 * (home.sc_1h + away.conc_1h) + 0.5 * (away.sc_1h + home.conc_1h);
  const mu_2h =
    0.5 * (home.sc_2h + away.conc_2h) + 0.5 * (away.sc_2h + home.conc_2h);
  const mu_2h_tilted = mu_2h * beta2hFor(league);
  const raw_total = mu_1h + mu_2h_tilted;
  const league_total = leagueTotalFor(league);

  let mu_1h_final: number;
  let mu_2h_final: number;
  let scale: number;
  let usedPriorSplit = false;

  if (raw_total === 0 || !Number.isFinite(raw_total)) {
    usedPriorSplit = true;
    scale = 1;
    mu_1h_final = league_total * 0.45;
    mu_2h_final = league_total * 0.55;
  } else {
    scale = league_total / raw_total;
    mu_1h_final = mu_1h * scale;
    mu_2h_final = mu_2h_tilted * scale;
  }

  const adj = Number.isFinite(formationAdjust) ? formationAdjust : 1;
  mu_1h_final *= adj;
  mu_2h_final *= adj;

  return {
    mu_1h,
    mu_2h,
    mu_2h_tilted,
    raw_total,
    scale,
    mu_1h_final,
    mu_2h_final,
    usedPriorSplit,
  };
}

/** Independent Poisson convolution up to POISSON_CAP (inclusive). */
export function poissonHalfProbs(
  mu_1h_final: number,
  mu_2h_final: number,
  cap: number = POISSON_CAP
): HalfProbResult {
  const pmf1 = Array.from({ length: cap + 1 }, (_, i) =>
    poissonPmf(i, Math.max(0, mu_1h_final))
  );
  const pmf2 = Array.from({ length: cap + 1 }, (_, j) =>
    poissonPmf(j, Math.max(0, mu_2h_final))
  );

  let p_2h_gt_1h = 0;
  let p_2h_eq_1h = 0;
  let p_2h_lt_1h = 0;
  for (let i = 0; i <= cap; i++) {
    for (let j = 0; j <= cap; j++) {
      const p = pmf1[i]! * pmf2[j]!;
      if (j > i) p_2h_gt_1h += p;
      else if (j === i) p_2h_eq_1h += p;
      else p_2h_lt_1h += p;
    }
  }

  return {
    p_2h_gt_1h,
    p_2h_eq_1h,
    p_2h_lt_1h,
    expected_1h: mu_1h_final,
    expected_2h: mu_2h_final,
  };
}

export function recencyFactor(
  lastMatchDateHome: string | null,
  lastMatchDateAway: string | null,
  nowMs: number = Date.now()
): number {
  const newest = newestIso(lastMatchDateHome, lastMatchDateAway);
  if (!newest) return RECENCY_PENALTY;
  const t = Date.parse(newest);
  if (!Number.isFinite(t)) return RECENCY_PENALTY;
  const ageDays = (nowMs - t) / (24 * 60 * 60 * 1000);
  return ageDays <= RECENCY_DAYS ? 1.0 : RECENCY_PENALTY;
}

function newestIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

export function computeConfidence(
  p_2h_gt_1h: number,
  homeN: number,
  awayN: number,
  lastHome: string | null,
  lastAway: string | null,
  nowMs?: number
): number {
  const data_factor = Math.min(1, Math.min(homeN, awayN) / MIN_MATCHES);
  const recency = recencyFactor(lastHome, lastAway, nowMs);
  return p_2h_gt_1h * data_factor * recency;
}

export function isThinData(homeN: number, awayN: number): boolean {
  return homeN < MIN_MATCHES || awayN < MIN_MATCHES;
}
