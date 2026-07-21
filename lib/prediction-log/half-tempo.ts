/**
 * Shared half-tempo proxies and λ nudges used by the merged Half Goals engine
 * (HSH backbone + former Half Comparison tempo/fatigue).
 */
import { standardizeTeamName } from "@/lib/data/team-names";
import type { PredictionBatch } from "./types";
import { lateGoalTempoScale } from "./league-priors";

export interface HalfTempoProfile {
  sampleWithTiming: number;
  fastStartRate: number | null;
  lateSurgeRate: number | null;
  /** Approximate minutes of first goal; null when unknown. */
  paceProxy: number | null;
  isFastStarter: boolean;
  isLateSurger: boolean;
}

const DEFAULT_TEMPO_SAMPLE_LIMIT = 15;
const FAST_START_PACE_THRESHOLD = 25;
const FAST_START_BOOST = 1.08;
const LATE_SURGE_RATE_THRESHOLD = 0.25;
const LATE_SURGE_BOOST = 1.1;
const FATIGUE_BOOST = 1.05;

/** Value-style callout when P(1H more goals) exceeds this. */
export const HALF_VALUE_ALERT_1H_THRESHOLD = 0.3;

function teamKey(name: string): string {
  return standardizeTeamName(name).trim().toLowerCase();
}

function isTeamInMatch(
  match: { homeTeam: string; awayTeam: string },
  team: string
): boolean {
  const key = teamKey(team);
  return teamKey(match.homeTeam) === key || teamKey(match.awayTeam) === key;
}

/**
 * Tempo proxies from MatchGoalTiming when present.
 * - fast start: goalInFirst10
 * - late surge: goalInLast10 OR timingBuckets.g76_90plus > 0
 */
export function estimateTempoProfile(
  batches: PredictionBatch[],
  team: string,
  opts?: { limit?: number; beforeDate?: string }
): HalfTempoProfile {
  const limit = opts?.limit ?? DEFAULT_TEMPO_SAMPLE_LIMIT;
  const samples: { fast: boolean; late: boolean; earlyPace: number | null }[] = [];

  for (const batch of batches) {
    for (const match of batch.matches) {
      const matchDate = match.matchDate ?? batch.date;
      if (opts?.beforeDate && matchDate >= opts.beforeDate) continue;
      if (!isTeamInMatch(match, team)) continue;
      const gt = match.teamStats?.goalTiming;
      if (!gt) continue;

      const hasFast = gt.goalInFirst10 === true;
      const hasLate =
        gt.goalInLast10 === true ||
        (gt.timingBuckets != null && (gt.timingBuckets.g76_90plus ?? 0) > 0);
      const hasAnySignal =
        gt.goalInFirst10 != null ||
        gt.goalInLast10 != null ||
        gt.timingBuckets != null;
      if (!hasAnySignal) continue;

      let earlyPace: number | null = null;
      if (gt.goalInFirst10 === true) earlyPace = 8;
      else if (gt.goalInFirst10 === false) earlyPace = 35;

      samples.push({ fast: hasFast, late: hasLate, earlyPace });
    }
  }

  samples.reverse();
  const sliced = samples.slice(0, limit);
  if (sliced.length === 0) {
    return {
      sampleWithTiming: 0,
      fastStartRate: null,
      lateSurgeRate: null,
      paceProxy: null,
      isFastStarter: false,
      isLateSurger: false,
    };
  }

  const n = sliced.length;
  const fastStartRate = sliced.filter((s) => s.fast).length / n;
  const lateSurgeRate = sliced.filter((s) => s.late).length / n;
  const paces = sliced.map((s) => s.earlyPace).filter((p): p is number => p != null);
  const paceProxy =
    paces.length > 0 ? paces.reduce((a, b) => a + b, 0) / paces.length : null;

  return {
    sampleWithTiming: n,
    fastStartRate,
    lateSurgeRate,
    paceProxy,
    isFastStarter:
      (paceProxy != null && paceProxy < FAST_START_PACE_THRESHOLD) ||
      (fastStartRate != null && fastStartRate >= 0.35),
    isLateSurger: lateSurgeRate != null && lateSurgeRate > LATE_SURGE_RATE_THRESHOLD,
  };
}

export interface HalfTempoNudgeResult {
  lambda1h: number;
  lambda2h: number;
  tempoBoost1h: boolean;
  lateSurgeBoost2h: boolean;
  fatigueBoost2h: boolean;
}

/** Apply HC-style tempo / late-surge / fatigue multipliers onto half totals. */
export function applyHalfTempoNudges(
  lambda1h: number,
  lambda2h: number,
  homeTempo: HalfTempoProfile,
  awayTempo: HalfTempoProfile,
  opts?: { lateGoalShare?: number | null }
): HalfTempoNudgeResult {
  let l1 = lambda1h;
  let l2 = lambda2h;

  const tempoBoost1h = homeTempo.isFastStarter || awayTempo.isFastStarter;
  if (tempoBoost1h) l1 *= FAST_START_BOOST;

  const lateScale = lateGoalTempoScale(opts?.lateGoalShare);
  const lateSurgeBoost2h = homeTempo.isLateSurger || awayTempo.isLateSurger;
  if (lateSurgeBoost2h) l2 *= LATE_SURGE_BOOST * lateScale;

  const fatigueBoost2h = true;
  l2 *= FATIGUE_BOOST * (0.5 + 0.5 * lateScale);

  return {
    lambda1h: Math.max(0.05, l1),
    lambda2h: Math.max(0.05, l2),
    tempoBoost1h,
    lateSurgeBoost2h,
    fatigueBoost2h,
  };
}

export function emptyHalfTempoProfile(): HalfTempoProfile {
  return {
    sampleWithTiming: 0,
    fastStartRate: null,
    lateSurgeRate: null,
    paceProxy: null,
    isFastStarter: false,
    isLateSurger: false,
  };
}

/** Tactical copy for merged Half Goals UI (1H / 2H / Tie). */
export function buildHalfGoalsTacticalNote(params: {
  homeTeam: string;
  awayTeam: string;
  homeTempo: HalfTempoProfile;
  awayTempo: HalfTempoProfile;
  recommended: "1H" | "2H" | "Tie";
}): string {
  const bits: string[] = [];
  if (params.homeTempo.isLateSurger) {
    bits.push(`${params.homeTeam}'s late-surge profile`);
  }
  if (params.awayTempo.isLateSurger) {
    bits.push(`${params.awayTeam}'s late-surge profile`);
  }
  if (params.homeTempo.isFastStarter) {
    bits.push(`${params.homeTeam} as a fast starter`);
  }
  if (params.awayTempo.isFastStarter) {
    bits.push(`${params.awayTeam} as a fast starter`);
  }
  if (bits.length === 0) {
    return params.recommended === "2H"
      ? "League-typical second-half lean; limited tempo signals in history."
      : "Based on attack × defence half λs with Dixon-Coles Stage B.";
  }
  const join =
    bits.length === 1
      ? bits[0]!
      : `${bits.slice(0, -1).join(", ")} + ${bits[bits.length - 1]}`;
  if (params.recommended === "2H") {
    return `${join} suggests strong 2H dominance.`;
  }
  if (params.recommended === "1H") {
    return `${join} supports first-half goal lean.`;
  }
  return `${join}; halves look closely matched.`;
}

export function tempoProfileLabel(
  isFast: boolean,
  isLate: boolean,
  pace: number | null
): string {
  if (isFast && pace != null) return `Fast starter (pace ~${Math.round(pace)}min)`;
  if (isFast) return "Fast starter";
  if (isLate) return "Strong finisher (late surge)";
  if (pace != null) return `Moderate (pace ~${Math.round(pace)}min)`;
  return "Limited tempo data";
}
