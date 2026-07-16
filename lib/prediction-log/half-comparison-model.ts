/**
 * Half Comparison Analysis — isolated two-stage model.
 *
 * Predicts the numerical relationship between half totals:
 *   1H > 2H | 1H = 2H | 2H > 1H
 *
 * Stage A: per-team avg 1H/2H scored & conceded (70/30 blend), league-anchored
 * (75/25), then tempo / fatigue nudges when goalTiming proxies exist.
 * Stage B: independent Poisson grid over half goal counts.
 *
 * Separate from Highest Scoring Half (share-blend + Dixon-Coles λ).
 * Advisory only — never blocks a bet.
 */
import { poissonPmf } from "@/lib/predictor/poisson";
import { standardizeTeamName } from "@/lib/data/team-names";
import { matchLeague } from "./match-league";
import type { LogMatch, PredictionBatch } from "./types";

export type HcOutcome = "1h_greater" | "equal" | "2h_greater";
export type HcConfidence = "very_high" | "high" | "moderate" | "low";
export type HcVenue = "home" | "away";

export interface HcTeamHalfAverages {
  sample: number;
  avg1hScored: number;
  avg2hScored: number;
  avg1hConceded: number;
  avg2hConceded: number;
  std1hScored: number;
  std2hScored: number;
}

export interface HcLeagueHalfAverages {
  sample: number;
  avg1h: number;
  avg2h: number;
  ratio: number;
  source: "computed" | "fallback";
}

export interface HcTempoProfile {
  sampleWithTiming: number;
  fastStartRate: number | null;
  lateSurgeRate: number | null;
  /** Approximate minutes of first goal; null when unknown. */
  paceProxy: number | null;
  isFastStarter: boolean;
  isLateSurger: boolean;
}

export interface HcStageAResult {
  expH1h: number;
  expH2h: number;
  expA1h: number;
  expA2h: number;
  lambda1h: number;
  lambda2h: number;
  tempoBoost1h: boolean;
  lateSurgeBoost2h: boolean;
  fatigueBoost2h: boolean;
}

export interface HcStageBResult {
  p1hGreater: number;
  pEqual: number;
  p2hGreater: number;
}

export interface HcPrediction {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  exp1h: number;
  exp2h: number;
  p1hGreater: number;
  pEqual: number;
  p2hGreater: number;
  recommendation: HcOutcome;
  topProbability: number;
  confidence: HcConfidence;
  valueAlert: boolean;
  tacticalNote: string;
  sampleSizeHome: number;
  sampleSizeAway: number;
  detail: {
    homeAvg1h: number;
    homeAvg2h: number;
    awayAvg1h: number;
    awayAvg2h: number;
    leagueAvg1h: number;
    leagueAvg2h: number;
    homeTempo: HcTempoProfile;
    awayTempo: HcTempoProfile;
    tempoBoost1h: boolean;
    lateSurgeBoost2h: boolean;
    fatigueBoost2h: boolean;
  };
}

const DEFAULT_HALF_SAMPLE_LIMIT = 15;
const TEAM_BLEND = 0.7;
const LEAGUE_ANCHOR_TEAM = 0.75;
const FAST_START_PACE_THRESHOLD = 25;
const FAST_START_BOOST = 1.08;
const LATE_SURGE_RATE_THRESHOLD = 0.25;
const LATE_SURGE_BOOST = 1.1;
const FATIGUE_BOOST = 1.05;
const POISSON_GRID_MAX_GOALS = 5;
const VALUE_ALERT_1H_THRESHOLD = 0.3;

/** Brief defaults when league history has no HT samples. */
export const LEAGUE_HALF_FALLBACKS: Record<string, { avg1h: number; avg2h: number }> = {
  "Premier League": { avg1h: 1.15, avg2h: 1.55 },
  "La Liga": { avg1h: 1.08, avg2h: 1.42 },
  "Ligue 1": { avg1h: 1.12, avg2h: 1.48 },
  Bundesliga: { avg1h: 1.22, avg2h: 1.62 },
  "Serie A": { avg1h: 1.05, avg2h: 1.38 },
};

const DEFAULT_LEAGUE_FALLBACK = { avg1h: 1.12, avg2h: 1.5 };

function teamKey(name: string): string {
  return standardizeTeamName(name).trim().toLowerCase();
}

function isTeamAtVenue(match: LogMatch, team: string, venue: HcVenue): boolean {
  const key = teamKey(team);
  const side = venue === "home" ? match.homeTeam : match.awayTeam;
  return teamKey(side) === key;
}

function isTeamInMatch(match: LogMatch, team: string): boolean {
  return isTeamAtVenue(match, team, "home") || isTeamAtVenue(match, team, "away");
}

interface SideHalfGoals {
  ft: number;
  ht: number;
}

function sideHalfGoals(match: LogMatch, venue: HcVenue): SideHalfGoals | null {
  const ts = match.teamStats;
  if (!ts) return null;
  const own = venue === "home" ? ts.home : ts.away;
  const opp = venue === "home" ? ts.away : ts.home;
  const ownFt = own?.goals;
  const ownHt = own?.firstHalfGoals;
  const oppFt = opp?.goals;
  const oppHt = opp?.firstHalfGoals;
  if (
    ownFt == null ||
    ownHt == null ||
    oppFt == null ||
    oppHt == null ||
    !Number.isFinite(ownFt) ||
    !Number.isFinite(ownHt) ||
    !Number.isFinite(oppFt) ||
    !Number.isFinite(oppHt)
  ) {
    return null;
  }
  return { ft: ownFt, ht: ownHt };
}

interface HalfPairSample {
  date: string;
  gf1h: number;
  gf2h: number;
  ga1h: number;
  ga2h: number;
}

function collectHalfPairSamples(
  batches: PredictionBatch[],
  team: string,
  venue: HcVenue,
  opts?: { beforeDate?: string }
): HalfPairSample[] {
  const out: HalfPairSample[] = [];
  for (const batch of batches) {
    const before = opts?.beforeDate;
    for (const match of batch.matches) {
      const matchDate = match.matchDate ?? batch.date;
      if (before && matchDate >= before) continue;
      if (!isTeamAtVenue(match, team, venue)) continue;
      const own = sideHalfGoals(match, venue);
      const opp = sideHalfGoals(match, venue === "home" ? "away" : "home");
      if (!own || !opp) continue;
      out.push({
        date: matchDate,
        gf1h: own.ht,
        gf2h: Math.max(0, own.ft - own.ht),
        ga1h: opp.ht,
        ga2h: Math.max(0, opp.ft - opp.ht),
      });
    }
  }
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

function sampleStd(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const varSum = values.reduce((a, v) => a + (v - mean) ** 2, 0);
  return Math.sqrt(varSum / (values.length - 1));
}

export function computeTeamHalfAverages(
  batches: PredictionBatch[],
  team: string,
  venue: HcVenue,
  opts?: { limit?: number; beforeDate?: string }
): HcTeamHalfAverages {
  const limit = opts?.limit ?? DEFAULT_HALF_SAMPLE_LIMIT;
  const samples = collectHalfPairSamples(batches, team, venue, opts).slice(0, limit);

  if (samples.length === 0) {
    return {
      sample: 0,
      avg1hScored: 0,
      avg2hScored: 0,
      avg1hConceded: 0,
      avg2hConceded: 0,
      std1hScored: 0,
      std2hScored: 0,
    };
  }

  const n = samples.length;
  const avg = (pick: (s: HalfPairSample) => number) =>
    samples.reduce((acc, s) => acc + pick(s), 0) / n;

  return {
    sample: n,
    avg1hScored: avg((s) => s.gf1h),
    avg2hScored: avg((s) => s.gf2h),
    avg1hConceded: avg((s) => s.ga1h),
    avg2hConceded: avg((s) => s.ga2h),
    std1hScored: sampleStd(samples.map((s) => s.gf1h)),
    std2hScored: sampleStd(samples.map((s) => s.gf2h)),
  };
}

export function computeLeagueHalfAverages(
  batches: PredictionBatch[],
  league: string,
  opts?: { beforeDate?: string }
): HcLeagueHalfAverages {
  let g1Total = 0;
  let g2Total = 0;
  let sample = 0;

  for (const batch of batches) {
    for (const match of batch.matches) {
      const matchDate = match.matchDate ?? batch.date;
      if (opts?.beforeDate && matchDate >= opts.beforeDate) continue;
      if (matchLeague(match, batch.league) !== league) continue;
      const home = sideHalfGoals(match, "home");
      const away = sideHalfGoals(match, "away");
      if (!home || !away) continue;
      g1Total += home.ht + away.ht;
      g2Total += home.ft - home.ht + (away.ft - away.ht);
      sample += 1;
    }
  }

  if (sample >= 6) {
    const avg1h = g1Total / sample;
    const avg2h = g2Total / sample;
    return {
      sample,
      avg1h,
      avg2h,
      ratio: avg2h > 0 ? avg1h / avg2h : 0.75,
      source: "computed",
    };
  }

  const fb = LEAGUE_HALF_FALLBACKS[league] ?? DEFAULT_LEAGUE_FALLBACK;
  return {
    sample,
    avg1h: fb.avg1h,
    avg2h: fb.avg2h,
    ratio: fb.avg2h > 0 ? fb.avg1h / fb.avg2h : 0.75,
    source: "fallback",
  };
}

/**
 * Tempo proxies from MatchGoalTiming when present.
 * - fast start: goalInFirst10
 * - late surge: goalInLast10 OR timingBuckets.g76_90plus > 0
 * - paceProxy: rough first-goal minute estimate from early flags only
 */
export function estimateTempoProfile(
  batches: PredictionBatch[],
  team: string,
  opts?: { limit?: number; beforeDate?: string }
): HcTempoProfile {
  const limit = opts?.limit ?? DEFAULT_HALF_SAMPLE_LIMIT;
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

export function computeStageA(params: {
  homeAvg: HcTeamHalfAverages;
  awayAvg: HcTeamHalfAverages;
  leagueAvg: HcLeagueHalfAverages;
  homeTempo: HcTempoProfile;
  awayTempo: HcTempoProfile;
}): HcStageAResult {
  const { homeAvg, awayAvg, leagueAvg, homeTempo, awayTempo } = params;

  // When a side has no samples, fall back to league half avgs for that side's contribution.
  const h1s = homeAvg.sample > 0 ? homeAvg.avg1hScored : leagueAvg.avg1h / 2;
  const h2s = homeAvg.sample > 0 ? homeAvg.avg2hScored : leagueAvg.avg2h / 2;
  const h1c = homeAvg.sample > 0 ? homeAvg.avg1hConceded : leagueAvg.avg1h / 2;
  const h2c = homeAvg.sample > 0 ? homeAvg.avg2hConceded : leagueAvg.avg2h / 2;
  const a1s = awayAvg.sample > 0 ? awayAvg.avg1hScored : leagueAvg.avg1h / 2;
  const a2s = awayAvg.sample > 0 ? awayAvg.avg2hScored : leagueAvg.avg2h / 2;
  const a1c = awayAvg.sample > 0 ? awayAvg.avg1hConceded : leagueAvg.avg1h / 2;
  const a2c = awayAvg.sample > 0 ? awayAvg.avg2hConceded : leagueAvg.avg2h / 2;

  const expH1hRaw = h1s * TEAM_BLEND + a1c * (1 - TEAM_BLEND);
  const expH2hRaw = h2s * TEAM_BLEND + a2c * (1 - TEAM_BLEND);
  const expA1hRaw = a1s * TEAM_BLEND + h1c * (1 - TEAM_BLEND);
  const expA2hRaw = a2s * TEAM_BLEND + h2c * (1 - TEAM_BLEND);

  const expH1h =
    expH1hRaw * LEAGUE_ANCHOR_TEAM + leagueAvg.avg1h * (1 - LEAGUE_ANCHOR_TEAM);
  const expH2h =
    expH2hRaw * LEAGUE_ANCHOR_TEAM + leagueAvg.avg2h * (1 - LEAGUE_ANCHOR_TEAM);
  const expA1h =
    expA1hRaw * LEAGUE_ANCHOR_TEAM + leagueAvg.avg1h * (1 - LEAGUE_ANCHOR_TEAM);
  const expA2h =
    expA2hRaw * LEAGUE_ANCHOR_TEAM + leagueAvg.avg2h * (1 - LEAGUE_ANCHOR_TEAM);

  let lambda1h = expH1h + expA1h;
  let lambda2h = expH2h + expA2h;

  const tempoBoost1h = homeTempo.isFastStarter || awayTempo.isFastStarter;
  if (tempoBoost1h) lambda1h *= FAST_START_BOOST;

  const lateSurgeBoost2h = homeTempo.isLateSurger || awayTempo.isLateSurger;
  if (lateSurgeBoost2h) lambda2h *= LATE_SURGE_BOOST;

  // Natural 2H open-play / fatigue factor always applied (brief).
  const fatigueBoost2h = true;
  lambda2h *= FATIGUE_BOOST;

  return {
    expH1h,
    expH2h,
    expA1h,
    expA2h,
    lambda1h: Math.max(0.05, lambda1h),
    lambda2h: Math.max(0.05, lambda2h),
    tempoBoost1h,
    lateSurgeBoost2h,
    fatigueBoost2h,
  };
}

export function computeStageB(
  lambda1h: number,
  lambda2h: number,
  maxGoals: number = POISSON_GRID_MAX_GOALS
): HcStageBResult {
  const pmf1 = Array.from({ length: maxGoals + 1 }, (_, g) =>
    poissonPmf(g, Math.max(0, lambda1h))
  );
  const pmf2 = Array.from({ length: maxGoals + 1 }, (_, g) =>
    poissonPmf(g, Math.max(0, lambda2h))
  );

  let p1hGreater = 0;
  let pEqual = 0;
  let p2hGreater = 0;
  for (let g1 = 0; g1 <= maxGoals; g1++) {
    for (let g2 = 0; g2 <= maxGoals; g2++) {
      const p = pmf1[g1]! * pmf2[g2]!;
      if (g1 > g2) p1hGreater += p;
      else if (g2 > g1) p2hGreater += p;
      else pEqual += p;
    }
  }

  const total = p1hGreater + pEqual + p2hGreater;
  if (total <= 0) return { p1hGreater: 0, pEqual: 1, p2hGreater: 0 };
  return {
    p1hGreater: p1hGreater / total,
    pEqual: pEqual / total,
    p2hGreater: p2hGreater / total,
  };
}

export function getRecommendation(stageB: HcStageBResult): HcOutcome {
  if (stageB.p2hGreater >= stageB.p1hGreater && stageB.p2hGreater >= stageB.pEqual) {
    return "2h_greater";
  }
  if (stageB.p1hGreater >= stageB.pEqual) return "1h_greater";
  return "equal";
}

export function topProbability(stageB: HcStageBResult): number {
  return Math.max(stageB.p1hGreater, stageB.pEqual, stageB.p2hGreater);
}

export function confidenceBand(topProb: number): HcConfidence {
  if (topProb >= 0.6) return "very_high";
  if (topProb >= 0.5) return "high";
  if (topProb >= 0.4) return "moderate";
  return "low";
}

export function recommendationLabel(outcome: HcOutcome): string {
  switch (outcome) {
    case "1h_greater":
      return "First Half More Goals";
    case "equal":
      return "Equal Goals";
    case "2h_greater":
      return "Second Half More Goals";
  }
}

export function buildTacticalNote(params: {
  homeTeam: string;
  awayTeam: string;
  homeTempo: HcTempoProfile;
  awayTempo: HcTempoProfile;
  recommendation: HcOutcome;
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
    return params.recommendation === "2h_greater"
      ? "League-typical second-half dominance; limited tempo signals in history."
      : "Based on half-goal averages and league anchoring.";
  }
  const join = bits.length === 1 ? bits[0]! : `${bits.slice(0, -1).join(", ")} + ${bits[bits.length - 1]}`;
  if (params.recommendation === "2h_greater") {
    return `${join} suggests strong 2H dominance.`;
  }
  if (params.recommendation === "1h_greater") {
    return `${join} supports first-half goal lean.`;
  }
  return `${join}; halves look evenly matched.`;
}

export const HALF_COMPARISON_ML_ENABLED = false;

/** Feature vector stub for a future 3-class XGBoost/LightGBM upgrade. */
export function buildHalfComparisonFeatures(ctx: {
  homeAvg: HcTeamHalfAverages;
  awayAvg: HcTeamHalfAverages;
  leagueAvg: HcLeagueHalfAverages;
  homeTempo: HcTempoProfile;
  awayTempo: HcTempoProfile;
  restDaysHome: number | null;
  restDaysAway: number | null;
}): Record<string, number> {
  return {
    home_1h_avg: ctx.homeAvg.avg1hScored,
    home_2h_avg: ctx.homeAvg.avg2hScored,
    away_1h_avg: ctx.awayAvg.avg1hScored,
    away_2h_avg: ctx.awayAvg.avg2hScored,
    home_pace_index: ctx.homeTempo.paceProxy ?? 30,
    away_pace_index: ctx.awayTempo.paceProxy ?? 30,
    league_1h_2h_ratio: ctx.leagueAvg.ratio,
    home_fast_start: ctx.homeTempo.isFastStarter ? 1 : 0,
    away_fast_start: ctx.awayTempo.isFastStarter ? 1 : 0,
    home_late_surge: ctx.homeTempo.isLateSurger ? 1 : 0,
    away_late_surge: ctx.awayTempo.isLateSurger ? 1 : 0,
    rest_days_home: ctx.restDaysHome ?? 7,
    rest_days_away: ctx.restDaysAway ?? 7,
    importance: 3,
  };
}

export interface HcMatchContext {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  homeAvg: HcTeamHalfAverages;
  awayAvg: HcTeamHalfAverages;
  leagueAvg: HcLeagueHalfAverages;
  homeTempo: HcTempoProfile;
  awayTempo: HcTempoProfile;
}

export function predictHalfComparison(ctx: HcMatchContext): HcPrediction {
  const stageA = computeStageA({
    homeAvg: ctx.homeAvg,
    awayAvg: ctx.awayAvg,
    leagueAvg: ctx.leagueAvg,
    homeTempo: ctx.homeTempo,
    awayTempo: ctx.awayTempo,
  });

  const stageB = computeStageB(stageA.lambda1h, stageA.lambda2h);
  const recommendation = getRecommendation(stageB);
  const top = topProbability(stageB);
  const valueAlert = stageB.p1hGreater > VALUE_ALERT_1H_THRESHOLD;

  return {
    matchId: ctx.matchId,
    homeTeam: ctx.homeTeam,
    awayTeam: ctx.awayTeam,
    league: ctx.league,
    exp1h: stageA.lambda1h,
    exp2h: stageA.lambda2h,
    p1hGreater: stageB.p1hGreater,
    pEqual: stageB.pEqual,
    p2hGreater: stageB.p2hGreater,
    recommendation,
    topProbability: top,
    confidence: confidenceBand(top),
    valueAlert,
    tacticalNote: buildTacticalNote({
      homeTeam: ctx.homeTeam,
      awayTeam: ctx.awayTeam,
      homeTempo: ctx.homeTempo,
      awayTempo: ctx.awayTempo,
      recommendation,
    }),
    sampleSizeHome: ctx.homeAvg.sample,
    sampleSizeAway: ctx.awayAvg.sample,
    detail: {
      homeAvg1h: ctx.homeAvg.avg1hScored,
      homeAvg2h: ctx.homeAvg.avg2hScored,
      awayAvg1h: ctx.awayAvg.avg1hScored,
      awayAvg2h: ctx.awayAvg.avg2hScored,
      leagueAvg1h: ctx.leagueAvg.avg1h,
      leagueAvg2h: ctx.leagueAvg.avg2h,
      homeTempo: ctx.homeTempo,
      awayTempo: ctx.awayTempo,
      tempoBoost1h: stageA.tempoBoost1h,
      lateSurgeBoost2h: stageA.lateSurgeBoost2h,
      fatigueBoost2h: stageA.fatigueBoost2h,
    },
  };
}
