/**
 * Highest Scoring Half (HSH) — isolated two-stage model.
 *
 * Stage A borrows expected total goals per team (xg_home/xg_away) from the
 * existing Dixon-Coles capacity engine (`computeLambdas`) — no duplication of
 * attack/defense strength math. Everything below (team/league half-share
 * blending, fatigue nudge, the independent-Poisson half-outcome grid, and
 * confidence banding) is new and specific to HSH; it does not feed back into
 * correct-score, combined-odds, or the recommendation engine.
 *
 * This module is advisory-only: it never blocks a bet.
 */
import { poissonPmf } from "@/lib/predictor/poisson";
import { standardizeTeamName } from "@/lib/data/team-names";
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
}

export interface HshLeagueHalfShare {
  sample: number;
  league1hShare: number;
  league2hShare: number;
  leagueAvgGoals: number;
}

export interface HshStageAResult {
  xgHome: number;
  xgAway: number;
  wTeam: number;
  homeShare1h: number;
  homeShare2h: number;
  awayShare1h: number;
  awayShare2h: number;
  lambda1h: number;
  lambda2h: number;
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
  sampleSizeHome: number;
  sampleSizeAway: number;
  usedManualOverride: boolean;
  detail: {
    xgHome: number;
    xgAway: number;
    wTeam: number;
    homeShare1h: number;
    awayShare1h: number;
    league1hShare: number;
    league2hShare: number;
    fatigueNudgeApplied: boolean;
    restDaysHome: number | null;
    restDaysAway: number | null;
  };
}

const DEFAULT_HALF_SAMPLE_LIMIT = 20;
const DEFAULT_W_TEAM = 0.65;
const FATIGUE_REST_DAYS_THRESHOLD = 3;
const FATIGUE_NUDGE_FRACTION = 0.04;
const POISSON_GRID_MAX_GOALS = 6;

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
  opts?: { limit?: number; beforeDate?: string }
): HshTeamHalfShare {
  const limit = opts?.limit ?? DEFAULT_HALF_SAMPLE_LIMIT;
  const samples = collectHalfPairSamples(batches, team, venue, opts).slice(0, limit);

  if (samples.length === 0) {
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
    };
  }

  const n = samples.length;
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
  };
}

export function computeLeagueHalfShare(
  batches: PredictionBatch[],
  league: string,
  opts?: { beforeDate?: string }
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

  if (sample === 0 || g1Total + g2Total === 0) {
    return { sample: 0, league1hShare: 0.45, league2hShare: 0.55, leagueAvgGoals: 2.6 };
  }

  const league1hShare = g1Total / (g1Total + g2Total);
  return {
    sample,
    league1hShare,
    league2hShare: 1 - league1hShare,
    leagueAvgGoals: goalsTotal / sample,
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
    xgHome,
    xgAway,
    wTeam,
    homeShare1h,
    homeShare2h,
    awayShare1h,
    awayShare2h,
    lambda1h,
    lambda2h,
    fatigueNudgeApplied: nudge > 0,
    restDaysHome,
    restDaysAway,
  };
}

/** Independent-Poisson grid over first/second-half goal counts. */
export function computeStageB(
  lambda1h: number,
  lambda2h: number,
  maxGoals: number = POISSON_GRID_MAX_GOALS
): HshStageBResult {
  const pmf1 = Array.from({ length: maxGoals + 1 }, (_, g) => poissonPmf(g, Math.max(0, lambda1h)));
  const pmf2 = Array.from({ length: maxGoals + 1 }, (_, g) => poissonPmf(g, Math.max(0, lambda2h)));

  let p1h = 0;
  let p2h = 0;
  let pTie = 0;
  for (let g1 = 0; g1 <= maxGoals; g1++) {
    for (let g2 = 0; g2 <= maxGoals; g2++) {
      const p = pmf1[g1]! * pmf2[g2]!;
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

/**
 * Confidence rules (advisory only — never blocks a pick):
 *  - high:   top prob >= 0.50 AND both teams have >= 12 half-split samples
 *  - medium: top prob in [0.40, 0.50) OR either team has 6-11 samples
 *  - low:    either team has < 6 samples, OR top prob < 0.40
 */
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

/**
 * Upgrade seam for the ML classifier described in the spec (XGBoost/LightGBM
 * 3-class, stacked on the Poisson outputs). Disabled until a trained model
 * and its probabilities are wired in — blending defaults to pure Poisson.
 */
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
  xgHome: number;
  xgAway: number;
  homeHalfShare: HshTeamHalfShare;
  awayHalfShare: HshTeamHalfShare;
  leagueHalfShare: HshLeagueHalfShare;
  restDaysHome?: number | null;
  restDaysAway?: number | null;
  wTeam?: number;
  manualLambda1h?: number;
  manualLambda2h?: number;
  mlProbabilities?: HshStageBResult | null;
  mlAlpha?: number;
}

export function predictHighestScoringHalf(ctx: HshMatchContext): HshPrediction {
  const hasManualOverride = ctx.manualLambda1h != null && ctx.manualLambda2h != null;

  const stageA = computeStageA({
    xgHome: ctx.xgHome,
    xgAway: ctx.xgAway,
    homeHalfShare: ctx.homeHalfShare,
    awayHalfShare: ctx.awayHalfShare,
    leagueHalfShare: ctx.leagueHalfShare,
    restDaysHome: ctx.restDaysHome,
    restDaysAway: ctx.restDaysAway,
    wTeam: ctx.wTeam,
  });

  const lambda1h = hasManualOverride ? ctx.manualLambda1h! : stageA.lambda1h;
  const lambda2h = hasManualOverride ? ctx.manualLambda2h! : stageA.lambda2h;

  const poissonProbs = computeStageB(lambda1h, lambda2h);
  const finalProbs = HSH_ML_ENABLED
    ? blendHshProbabilities(poissonProbs, ctx.mlProbabilities ?? null, ctx.mlAlpha ?? 1)
    : poissonProbs;

  const top = topProbability(finalProbs);

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
    recommended: recommendedHalf(finalProbs),
    topProbability: top,
    confidence: confidenceBand(top, ctx.homeHalfShare.sample, ctx.awayHalfShare.sample),
    sampleSizeHome: ctx.homeHalfShare.sample,
    sampleSizeAway: ctx.awayHalfShare.sample,
    usedManualOverride: hasManualOverride,
    detail: {
      xgHome: stageA.xgHome,
      xgAway: stageA.xgAway,
      wTeam: stageA.wTeam,
      homeShare1h: stageA.homeShare1h,
      awayShare1h: stageA.awayShare1h,
      league1hShare: ctx.leagueHalfShare.league1hShare,
      league2hShare: ctx.leagueHalfShare.league2hShare,
      fatigueNudgeApplied: stageA.fatigueNudgeApplied,
      restDaysHome: stageA.restDaysHome,
      restDaysAway: stageA.restDaysAway,
    },
  };
}
