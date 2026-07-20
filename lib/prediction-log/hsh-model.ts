/**
 * Highest Scoring Half / Half Goals — merged 1H vs 2H engine.
 *
 * Stage A: per-half λ = att × opp_def × Lg × home/away factor, then optional
 * tempo / late-surge / fatigue nudges (from former Half Comparison).
 * Stage B: independent Poisson grid with Dixon-Coles τ + mild 2H coupling.
 * Skellam headline for E[D].
 *
 * Advisory-only: never blocks a bet.
 */
import { poissonPmf } from "@/lib/predictor/poisson";
import { standardizeTeamName } from "@/lib/data/team-names";
import {
  HALF_BASELINE_SAMPLE_THRESHOLD,
  formatBaselineSource,
  lookupClubHalfBaseline,
  lookupLeagueHalfBaseline,
  seasonFromDate,
} from "./half-goals-baselines";
import {
  shrinkCoeff,
  type ClubHalfAttackDefence,
} from "./hsh-half-rates";
import {
  applyHalfTempoNudges,
  buildHalfGoalsTacticalNote,
  emptyHalfTempoProfile,
  HALF_VALUE_ALERT_1H_THRESHOLD,
  type HalfTempoProfile,
} from "./half-tempo";
import { matchLeague } from "./match-league";
import type { LogMatch, PredictionBatch } from "./types";

export type HshHalf = "1H" | "2H" | "Tie";
export type HshConfidence = "high" | "medium" | "low";
export type HshVenue = "home" | "away";

export interface HshTeamHalfShare {
  sample: number;
  gf1h: number;
  gf2h: number;
  ga1h: number;
  ga2h: number;
  share1h: number;
  share2h: number;
  p1hMore: number;
  p2hMore: number;
  pTie: number;
  baselineSource?: string | null;
}

export interface HshLeagueHalfShare {
  sample: number;
  league1hShare: number;
  league2hShare: number;
  leagueAvgGoals: number;
  baselineSource?: string | null;
}

export interface HshStageAResult {
  lambdaA1: number;
  lambdaB1: number;
  lambdaA2: number;
  lambdaB2: number;
  lambda1h: number;
  lambda2h: number;
  att1Home: number;
  att2Home: number;
  def1Home: number;
  def2Home: number;
  att1Away: number;
  att2Away: number;
  def1Away: number;
  def2Away: number;
  lgAf1: number;
  lgAf2: number;
  couplingApplied: boolean;
  /** Legacy fields kept for share-based helpers / older callers. */
  xgHome: number;
  xgAway: number;
  wTeam: number;
  homeShare1h: number;
  homeShare2h: number;
  awayShare1h: number;
  awayShare2h: number;
  fatigueNudgeApplied: boolean;
  restDaysHome: number | null;
  restDaysAway: number | null;
}

export interface HshStageBResult {
  p1h: number;
  p2h: number;
  pTie: number;
}

export interface HshPrediction {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  lambda1h: number;
  lambda2h: number;
  p1h: number;
  p2h: number;
  pTie: number;
  recommended: HshHalf;
  topProbability: number;
  confidence: HshConfidence;
  margin: number;
  expectedDiff: number;
  seDiff: number;
  sampleSizeHome: number;
  sampleSizeAway: number;
  usedManualOverride: boolean;
  valueAlert: boolean;
  tacticalNote: string;
  detail: {
    lambdaA1: number;
    lambdaB1: number;
    lambdaA2: number;
    lambdaB2: number;
    att1Home: number;
    att2Home: number;
    def1Home: number;
    def2Home: number;
    att1Away: number;
    att2Away: number;
    def1Away: number;
    def2Away: number;
    lgAf1: number;
    lgAf2: number;
    couplingApplied: boolean;
    seedHome?: string | null;
    seedAway?: string | null;
    /** Legacy detail keys (unused by new Stage A; kept optional for UI). */
    xgHome?: number;
    xgAway?: number;
    wTeam?: number;
    homeShare1h?: number;
    awayShare1h?: number;
    league1hShare?: number;
    league2hShare?: number;
    fatigueNudgeApplied?: boolean;
    restDaysHome?: number | null;
    restDaysAway?: number | null;
    baselineHome?: string | null;
    baselineAway?: string | null;
    baselineLeague?: string | null;
    tempoBoost1h?: boolean;
    lateSurgeBoost2h?: boolean;
    fatigueBoost2h?: boolean;
    homeTempo?: HalfTempoProfile;
    awayTempo?: HalfTempoProfile;
  };
}

const DEFAULT_HALF_SAMPLE_LIMIT = 20;
const DEFAULT_W_TEAM = 0.65;
const FATIGUE_REST_DAYS_THRESHOLD = 3;
const FATIGUE_NUDGE_FRACTION = 0.04;
const POISSON_GRID_MAX_GOALS = 8;
const HOME_FACTOR = 1.1;
const AWAY_FACTOR = 1 / 1.05;
const COUPLING = 0.06;
const TIE_TAU = 1.05;

function teamKey(name: string): string {
  return standardizeTeamName(name).trim().toLowerCase();
}

function isTeamAtVenue(match: LogMatch, team: string, venue: HshVenue): boolean {
  const key = teamKey(team);
  const side = venue === "home" ? match.homeTeam : match.awayTeam;
  return teamKey(side) === key;
}

interface SideHalfGoals {
  ft: number;
  ht: number;
}

/** Both sides' HT+FT must be present — half data is scraped together, so this rarely excludes valid matches. */
function sideHalfGoals(match: LogMatch, venue: HshVenue): SideHalfGoals | null {
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
  venue: HshVenue,
  opts?: { beforeDate?: string }
): HalfPairSample[] {
  const out: HalfPairSample[] = [];
  for (const batch of batches) {
    if (opts?.beforeDate && batch.date >= opts.beforeDate) continue;
    for (const match of batch.matches) {
      if (!isTeamAtVenue(match, team, venue)) continue;
      const own = sideHalfGoals(match, venue);
      const opp = sideHalfGoals(match, venue === "home" ? "away" : "home");
      if (!own || !opp) continue;
      out.push({
        date: batch.date,
        gf1h: own.ht,
        gf2h: own.ft - own.ht,
        ga1h: opp.ht,
        ga2h: opp.ft - opp.ht,
      });
    }
  }
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

export function computeTeamHalfShare(
  batches: PredictionBatch[],
  team: string,
  venue: HshVenue,
  opts?: { limit?: number; beforeDate?: string; league?: string; season?: string | null }
): HshTeamHalfShare {
  const limit = opts?.limit ?? DEFAULT_HALF_SAMPLE_LIMIT;
  const samples = collectHalfPairSamples(batches, team, venue, opts).slice(0, limit);
  const liveSample = samples.length;
  const season = opts?.season ?? seasonFromDate(opts?.beforeDate);
  const league = opts?.league ?? "";

  if (liveSample >= HALF_BASELINE_SAMPLE_THRESHOLD) {
    const n = liveSample;
    const sum = (pick: (s: HalfPairSample) => number) =>
      samples.reduce((acc, s) => acc + pick(s), 0);

    const gf1h = sum((s) => s.gf1h) / n;
    const gf2h = sum((s) => s.gf2h) / n;
    const ga1h = sum((s) => s.ga1h) / n;
    const ga2h = sum((s) => s.ga2h) / n;

    let more1h = 0;
    let more2h = 0;
    let tie = 0;
    for (const s of samples) {
      if (s.gf1h > s.gf2h) more1h += 1;
      else if (s.gf2h > s.gf1h) more2h += 1;
      else tie += 1;
    }

    const denom = gf1h + gf2h;
    const share1h = denom > 0 ? gf1h / denom : 0.5;

    return {
      sample: n,
      gf1h,
      gf2h,
      ga1h,
      ga2h,
      share1h,
      share2h: 1 - share1h,
      p1hMore: more1h / n,
      p2hMore: more2h / n,
      pTie: tie / n,
      baselineSource: null,
    };
  }

  const row = league ? lookupClubHalfBaseline(team, league, season) : null;
  if (row) {
    const leagueHalf = lookupLeagueHalfBaseline(row.league, row.season);
    const denom = row.avg1h + row.avg2h;
    const share1h = denom > 0 ? row.avg1h / denom : 0.45;
    const concede1h = leagueHalf ? leagueHalf.avg1h / 2 : row.avg1h;
    const concede2h = leagueHalf ? leagueHalf.avg2h / 2 : row.avg2h;
    return {
      sample: liveSample,
      gf1h: row.avg1h,
      gf2h: row.avg2h,
      ga1h: concede1h,
      ga2h: concede2h,
      share1h,
      share2h: 1 - share1h,
      p1hMore: row.pct1hGreater / 100,
      p2hMore: row.pct2hGreater / 100,
      pTie: row.pctEqual / 100,
      baselineSource: formatBaselineSource(row),
    };
  }

  if (liveSample === 0) {
    return {
      sample: 0,
      gf1h: 0,
      gf2h: 0,
      ga1h: 0,
      ga2h: 0,
      share1h: 0.5,
      share2h: 0.5,
      p1hMore: 0,
      p2hMore: 0,
      pTie: 0,
      baselineSource: null,
    };
  }

  // Thin live sample, no baseline row — keep computed thin stats.
  const n = liveSample;
  const sum = (pick: (s: HalfPairSample) => number) =>
    samples.reduce((acc, s) => acc + pick(s), 0);
  const gf1h = sum((s) => s.gf1h) / n;
  const gf2h = sum((s) => s.gf2h) / n;
  const ga1h = sum((s) => s.ga1h) / n;
  const ga2h = sum((s) => s.ga2h) / n;
  let more1h = 0;
  let more2h = 0;
  let tie = 0;
  for (const s of samples) {
    if (s.gf1h > s.gf2h) more1h += 1;
    else if (s.gf2h > s.gf1h) more2h += 1;
    else tie += 1;
  }
  const denom = gf1h + gf2h;
  const share1h = denom > 0 ? gf1h / denom : 0.5;
  return {
    sample: n,
    gf1h,
    gf2h,
    ga1h,
    ga2h,
    share1h,
    share2h: 1 - share1h,
    p1hMore: more1h / n,
    p2hMore: more2h / n,
    pTie: tie / n,
    baselineSource: null,
  };
}

export function computeLeagueHalfShare(
  batches: PredictionBatch[],
  league: string,
  opts?: { beforeDate?: string; season?: string | null }
): HshLeagueHalfShare {
  let g1Total = 0;
  let g2Total = 0;
  let goalsTotal = 0;
  let sample = 0;

  for (const batch of batches) {
    if (opts?.beforeDate && batch.date >= opts.beforeDate) continue;
    for (const match of batch.matches) {
      if (matchLeague(match, batch.league) !== league) continue;
      const home = sideHalfGoals(match, "home");
      const away = sideHalfGoals(match, "away");
      if (!home || !away) continue;
      g1Total += home.ht + away.ht;
      g2Total += home.ft - home.ht + (away.ft - away.ht);
      goalsTotal += home.ft + away.ft;
      sample += 1;
    }
  }

  const season = opts?.season ?? seasonFromDate(opts?.beforeDate);

  if (sample >= HALF_BASELINE_SAMPLE_THRESHOLD && g1Total + g2Total > 0) {
    const league1hShare = g1Total / (g1Total + g2Total);
    return {
      sample,
      league1hShare,
      league2hShare: 1 - league1hShare,
      leagueAvgGoals: goalsTotal / sample,
      baselineSource: null,
    };
  }

  const baseline = lookupLeagueHalfBaseline(league, season);
  if (baseline) {
    const denom = baseline.avg1h + baseline.avg2h;
    const league1hShare = denom > 0 ? baseline.avg1h / denom : 0.45;
    return {
      sample,
      league1hShare,
      league2hShare: 1 - league1hShare,
      leagueAvgGoals: baseline.avgGoals,
      baselineSource: baseline.sourceLabel,
    };
  }

  if (sample === 0 || g1Total + g2Total === 0) {
    return {
      sample: 0,
      league1hShare: 0.45,
      league2hShare: 0.55,
      leagueAvgGoals: 2.6,
      baselineSource: null,
    };
  }

  const league1hShare = g1Total / (g1Total + g2Total);
  return {
    sample,
    league1hShare,
    league2hShare: 1 - league1hShare,
    leagueAvgGoals: goalsTotal / sample,
    baselineSource: null,
  };
}

/** Days since this team's most recent prior fixture (any venue), or null if unknown. */
export function estimateRestDays(
  batches: PredictionBatch[],
  team: string,
  matchDate: string
): number | null {
  const target = Date.parse(matchDate);
  if (!Number.isFinite(target)) return null;

  let mostRecent: number | null = null;
  for (const batch of batches) {
    const batchTime = Date.parse(batch.date);
    if (!Number.isFinite(batchTime) || batchTime >= target) continue;
    const involved = batch.matches.some(
      (m) => isTeamAtVenue(m, team, "home") || isTeamAtVenue(m, team, "away")
    );
    if (!involved) continue;
    if (mostRecent == null || batchTime > mostRecent) mostRecent = batchTime;
  }

  if (mostRecent == null) return null;
  return Math.round((target - mostRecent) / (24 * 60 * 60 * 1000));
}

/** Attack × defence Stage A (brief §2–§3 + §6a–d). */
export function computeAttackDefenceStageA(params: {
  home: ClubHalfAttackDefence;
  away: ClubHalfAttackDefence;
  lgAf1: number;
  lgAf2: number;
}): HshStageAResult {
  const lgAf1 = Math.max(0.05, params.lgAf1);
  const lgAf2 = Math.max(0.05, params.lgAf2);
  const h = params.home;
  const a = params.away;

  const att1Home = shrinkCoeff(h.af1 / lgAf1, h.nMatches, h.seasonCount);
  const att2Home = shrinkCoeff(h.af2 / lgAf2, h.nMatches, h.seasonCount);
  const def1Home = shrinkCoeff(h.da1 / lgAf1, h.nMatches, h.seasonCount);
  const def2Home = shrinkCoeff(h.da2 / lgAf2, h.nMatches, h.seasonCount);
  const att1Away = shrinkCoeff(a.af1 / lgAf1, a.nMatches, a.seasonCount);
  const att2Away = shrinkCoeff(a.af2 / lgAf2, a.nMatches, a.seasonCount);
  const def1Away = shrinkCoeff(a.da1 / lgAf1, a.nMatches, a.seasonCount);
  const def2Away = shrinkCoeff(a.da2 / lgAf2, a.nMatches, a.seasonCount);

  const lambdaA1 = Math.max(0.05, att1Home * def1Away * lgAf1 * HOME_FACTOR);
  const lambdaB1 = Math.max(0.05, att1Away * def1Home * lgAf1 * AWAY_FACTOR);
  const lambdaA2 = Math.max(0.05, att2Home * def2Away * lgAf2 * HOME_FACTOR);
  const lambdaB2 = Math.max(0.05, att2Away * def2Home * lgAf2 * AWAY_FACTOR);

  const lambda1h = lambdaA1 + lambdaB1;
  let lambda2h = lambdaA2 + lambdaB2;
  const lg1hTotal = 2 * lgAf1;
  const couplingApplied = true;
  lambda2h = Math.max(0.05, lambda2h * (1 + COUPLING * (lambda1h - lg1hTotal)));

  return {
    lambdaA1,
    lambdaB1,
    lambdaA2,
    lambdaB2,
    lambda1h,
    lambda2h,
    att1Home,
    att2Home,
    def1Home,
    def2Home,
    att1Away,
    att2Away,
    def1Away,
    def2Away,
    lgAf1,
    lgAf2,
    couplingApplied,
    xgHome: h.af1 + h.af2,
    xgAway: a.af1 + a.af2,
    wTeam: DEFAULT_W_TEAM,
    homeShare1h: h.af1 / Math.max(0.01, h.af1 + h.af2),
    homeShare2h: h.af2 / Math.max(0.01, h.af1 + h.af2),
    awayShare1h: a.af1 / Math.max(0.01, a.af1 + a.af2),
    awayShare2h: a.af2 / Math.max(0.01, a.af1 + a.af2),
    fatigueNudgeApplied: false,
    restDaysHome: null,
    restDaysAway: null,
  };
}

/** @deprecated Legacy share×FT Stage A — prefer computeAttackDefenceStageA. */
export function computeStageA(params: {
  xgHome: number;
  xgAway: number;
  homeHalfShare: HshTeamHalfShare;
  awayHalfShare: HshTeamHalfShare;
  leagueHalfShare: HshLeagueHalfShare;
  restDaysHome?: number | null;
  restDaysAway?: number | null;
  wTeam?: number;
}): HshStageAResult {
  const wTeam = params.wTeam ?? DEFAULT_W_TEAM;
  const xgHome = Math.max(0, params.xgHome);
  const xgAway = Math.max(0, params.xgAway);

  const homeShare1h =
    wTeam * params.homeHalfShare.share1h + (1 - wTeam) * params.leagueHalfShare.league1hShare;
  const awayShare1h =
    wTeam * params.awayHalfShare.share1h + (1 - wTeam) * params.leagueHalfShare.league1hShare;
  const homeShare2h = 1 - homeShare1h;
  const awayShare2h = 1 - awayShare1h;

  let lambda1h = xgHome * homeShare1h + xgAway * awayShare1h;
  let lambda2h = xgHome * homeShare2h + xgAway * awayShare2h;

  const restDaysHome = params.restDaysHome ?? null;
  const restDaysAway = params.restDaysAway ?? null;
  let nudge = 0;
  if (restDaysHome != null && restDaysHome <= FATIGUE_REST_DAYS_THRESHOLD) {
    nudge += FATIGUE_NUDGE_FRACTION * xgHome;
  }
  if (restDaysAway != null && restDaysAway <= FATIGUE_REST_DAYS_THRESHOLD) {
    nudge += FATIGUE_NUDGE_FRACTION * xgAway;
  }
  const maxNudge = 0.05 * (xgHome + xgAway);
  nudge = Math.min(nudge, maxNudge);

  if (nudge > 0) {
    lambda1h = Math.max(0.05, lambda1h - nudge);
    lambda2h = lambda2h + nudge;
  }

  return {
    lambdaA1: lambda1h * 0.55,
    lambdaB1: lambda1h * 0.45,
    lambdaA2: lambda2h * 0.55,
    lambdaB2: lambda2h * 0.45,
    lambda1h,
    lambda2h,
    att1Home: 1,
    att2Home: 1,
    def1Home: 1,
    def2Home: 1,
    att1Away: 1,
    att2Away: 1,
    def1Away: 1,
    def2Away: 1,
    lgAf1: 0.62,
    lgAf2: 0.78,
    couplingApplied: false,
    xgHome,
    xgAway,
    wTeam,
    homeShare1h,
    homeShare2h,
    awayShare1h,
    awayShare2h,
    fatigueNudgeApplied: nudge > 0,
    restDaysHome,
    restDaysAway,
  };
}

/** Modified Bessel I0 series (k=0..20). */
export function besselI0(x: number): number {
  const ax = Math.abs(x);
  let sum = 1;
  let term = 1;
  for (let k = 1; k <= 20; k++) {
    term *= (ax / (2 * k)) * (ax / (2 * k));
    sum += term;
  }
  return sum;
}

export function skellamHeadline(lambda1h: number, lambda2h: number): {
  expectedDiff: number;
  seDiff: number;
  pTieSkellam: number;
} {
  const l1 = Math.max(0, lambda1h);
  const l2 = Math.max(0, lambda2h);
  const expectedDiff = l1 - l2;
  const seDiff = Math.sqrt(l1 + l2);
  const pTieSkellam = Math.exp(-(l1 + l2)) * besselI0(2 * Math.sqrt(l1 * l2));
  return { expectedDiff, seDiff, pTieSkellam };
}

/**
 * Independent-Poisson grid with Dixon-Coles τ on (0,0) and (1,1).
 * Outcomes: p1h = P(1H>2H), p2h = P(2H>1H), pTie = P(equal).
 */
export function computeStageB(
  lambda1h: number,
  lambda2h: number,
  maxGoals: number = POISSON_GRID_MAX_GOALS,
  opts?: { applyTau?: boolean }
): HshStageBResult {
  const applyTau = opts?.applyTau !== false;
  const pmf1 = Array.from({ length: maxGoals + 1 }, (_, g) => poissonPmf(g, Math.max(0, lambda1h)));
  const pmf2 = Array.from({ length: maxGoals + 1 }, (_, g) => poissonPmf(g, Math.max(0, lambda2h)));

  let p1h = 0;
  let p2h = 0;
  let pTie = 0;
  for (let g1 = 0; g1 <= maxGoals; g1++) {
    for (let g2 = 0; g2 <= maxGoals; g2++) {
      let p = pmf1[g1]! * pmf2[g2]!;
      if (applyTau && g1 === g2 && (g1 === 0 || g1 === 1)) p *= TIE_TAU;
      if (g1 > g2) p1h += p;
      else if (g2 > g1) p2h += p;
      else pTie += p;
    }
  }

  const total = p1h + p2h + pTie;
  if (total <= 0) return { p1h: 0, p2h: 0, pTie: 1 };
  return { p1h: p1h / total, p2h: p2h / total, pTie: pTie / total };
}

export function recommendedHalf(stageB: HshStageBResult): HshHalf {
  if (stageB.p2h >= stageB.p1h && stageB.p2h >= stageB.pTie) return "2H";
  if (stageB.p1h >= stageB.pTie) return "1H";
  return "Tie";
}

export function topProbability(stageB: HshStageBResult): number {
  return Math.max(stageB.p1h, stageB.p2h, stageB.pTie);
}

export function probabilityMargin(stageB: HshStageBResult): number {
  const vals = [stageB.p1h, stageB.p2h, stageB.pTie].sort((a, b) => b - a);
  return (vals[0] ?? 0) - (vals[1] ?? 0);
}

/**
 * High: margin ≥ 0.15 AND both clubs ≥3 seasons
 * Medium: 0.07 ≤ margin < 0.15
 * Low: margin < 0.07 OR either club seed-only
 */
export function confidenceBandFromMargin(
  margin: number,
  homeSeasonCount: number,
  awaySeasonCount: number,
  homeSeedOnly: boolean,
  awaySeedOnly: boolean
): HshConfidence {
  if (homeSeedOnly || awaySeedOnly || margin < 0.07) return "low";
  if (margin >= 0.15 && homeSeasonCount >= 3 && awaySeasonCount >= 3) return "high";
  if (margin >= 0.07) return "medium";
  return "low";
}

/** @deprecated Prefer confidenceBandFromMargin. */
export function confidenceBand(
  topProb: number,
  sampleSizeHome: number,
  sampleSizeAway: number
): HshConfidence {
  const minSample = Math.min(sampleSizeHome, sampleSizeAway);
  if (topProb >= 0.5 && minSample >= 12) return "high";
  if ((topProb >= 0.4 && topProb < 0.5) || (minSample >= 6 && minSample < 12)) return "medium";
  return "low";
}

export const HSH_ML_ENABLED = false;

export function blendHshProbabilities(
  poisson: HshStageBResult,
  ml: HshStageBResult | null,
  alpha: number = 1
): HshStageBResult {
  if (!ml || alpha >= 1) return poisson;
  const a = Math.max(0, Math.min(1, alpha));
  return {
    p1h: a * poisson.p1h + (1 - a) * ml.p1h,
    p2h: a * poisson.p2h + (1 - a) * ml.p2h,
    pTie: a * poisson.pTie + (1 - a) * ml.pTie,
  };
}

export interface HshMatchContext {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  homeRates: ClubHalfAttackDefence;
  awayRates: ClubHalfAttackDefence;
  lgAf1: number;
  lgAf2: number;
  homeTempo?: HalfTempoProfile;
  awayTempo?: HalfTempoProfile;
  manualLambda1h?: number;
  manualLambda2h?: number;
  mlProbabilities?: HshStageBResult | null;
  mlAlpha?: number;
}

export function predictHighestScoringHalf(ctx: HshMatchContext): HshPrediction {
  const hasManualOverride = ctx.manualLambda1h != null && ctx.manualLambda2h != null;

  const stageA = computeAttackDefenceStageA({
    home: ctx.homeRates,
    away: ctx.awayRates,
    lgAf1: ctx.lgAf1,
    lgAf2: ctx.lgAf2,
  });

  const homeTempo = ctx.homeTempo ?? emptyHalfTempoProfile();
  const awayTempo = ctx.awayTempo ?? emptyHalfTempoProfile();

  let lambda1h = stageA.lambda1h;
  let lambda2h = stageA.lambda2h;
  let tempoBoost1h = false;
  let lateSurgeBoost2h = false;
  let fatigueBoost2h = false;

  if (!hasManualOverride) {
    const nudged = applyHalfTempoNudges(
      stageA.lambda1h,
      stageA.lambda2h,
      homeTempo,
      awayTempo
    );
    lambda1h = nudged.lambda1h;
    lambda2h = nudged.lambda2h;
    tempoBoost1h = nudged.tempoBoost1h;
    lateSurgeBoost2h = nudged.lateSurgeBoost2h;
    fatigueBoost2h = nudged.fatigueBoost2h;
  } else {
    lambda1h = ctx.manualLambda1h!;
    lambda2h = ctx.manualLambda2h!;
  }

  const poissonProbs = computeStageB(lambda1h, lambda2h);
  const finalProbs = HSH_ML_ENABLED
    ? blendHshProbabilities(poissonProbs, ctx.mlProbabilities ?? null, ctx.mlAlpha ?? 1)
    : poissonProbs;

  const top = topProbability(finalProbs);
  const margin = probabilityMargin(finalProbs);
  const { expectedDiff, seDiff } = skellamHeadline(lambda1h, lambda2h);
  const confidence = confidenceBandFromMargin(
    margin,
    ctx.homeRates.seasonCount,
    ctx.awayRates.seasonCount,
    ctx.homeRates.seedOnly,
    ctx.awayRates.seedOnly
  );
  const recommended = recommendedHalf(finalProbs);
  const tacticalNote = buildHalfGoalsTacticalNote({
    homeTeam: ctx.homeTeam,
    awayTeam: ctx.awayTeam,
    homeTempo,
    awayTempo,
    recommended,
  });
  const valueAlert = finalProbs.p1h > HALF_VALUE_ALERT_1H_THRESHOLD;

  return {
    matchId: ctx.matchId,
    homeTeam: ctx.homeTeam,
    awayTeam: ctx.awayTeam,
    league: ctx.league,
    lambda1h,
    lambda2h,
    p1h: finalProbs.p1h,
    p2h: finalProbs.p2h,
    pTie: finalProbs.pTie,
    recommended,
    topProbability: top,
    confidence,
    margin,
    expectedDiff,
    seDiff,
    sampleSizeHome: Math.round(ctx.homeRates.nMatches),
    sampleSizeAway: Math.round(ctx.awayRates.nMatches),
    usedManualOverride: hasManualOverride,
    valueAlert,
    tacticalNote,
    detail: {
      lambdaA1: stageA.lambdaA1,
      lambdaB1: stageA.lambdaB1,
      lambdaA2: stageA.lambdaA2,
      lambdaB2: stageA.lambdaB2,
      att1Home: stageA.att1Home,
      att2Home: stageA.att2Home,
      def1Home: stageA.def1Home,
      def2Home: stageA.def2Home,
      att1Away: stageA.att1Away,
      att2Away: stageA.att2Away,
      def1Away: stageA.def1Away,
      def2Away: stageA.def2Away,
      lgAf1: stageA.lgAf1,
      lgAf2: stageA.lgAf2,
      couplingApplied: stageA.couplingApplied,
      seedHome: ctx.homeRates.sourceNote,
      seedAway: ctx.awayRates.sourceNote,
      tempoBoost1h,
      lateSurgeBoost2h,
      fatigueBoost2h,
      homeTempo,
      awayTempo,
    },
  };
}

const CONF_WEIGHT: Record<HshConfidence, number> = { high: 1, medium: 0.7, low: 0.4 };

/** Batch-best pick: max margin × confidence weight (advisory only). */
export function pickBatchBestHsh(predictions: HshPrediction[]): HshPrediction | null {
  if (predictions.length === 0) return null;
  let best = predictions[0]!;
  let bestScore = best.margin * CONF_WEIGHT[best.confidence];
  for (let i = 1; i < predictions.length; i++) {
    const p = predictions[i]!;
    const score = p.margin * CONF_WEIGHT[p.confidence];
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}
