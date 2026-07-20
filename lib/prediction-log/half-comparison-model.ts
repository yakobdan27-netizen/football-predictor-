/**
 * Half Comparison helpers retained for averages / legacy tests.
 * Live Half Goals predictions use the merged HSH + tempo engine in hsh-model.ts.
 */
import { poissonPmf } from "@/lib/predictor/poisson";
import { standardizeTeamName } from "@/lib/data/team-names";
import {
  HALF_BASELINE_SAMPLE_THRESHOLD,
  builtInLeagueHalfFallbacks,
  formatBaselineSource,
  lookupClubHalfBaseline,
  lookupLeagueHalfBaseline,
  seasonFromDate,
} from "./half-goals-baselines";
import {
  applyHalfTempoNudges,
  buildHalfGoalsTacticalNote,
  emptyHalfTempoProfile,
  estimateTempoProfile,
  HALF_VALUE_ALERT_1H_THRESHOLD,
  type HalfTempoProfile,
} from "./half-tempo";
import { matchLeague } from "./match-league";
import type { LogMatch, PredictionBatch } from "./types";

/** @deprecated alias — use HalfTempoProfile from half-tempo */
export type HcTempoProfile = HalfTempoProfile;
export { estimateTempoProfile, emptyHalfTempoProfile as emptyTempoProfile };

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
  /** Set when cold-start club baseline filled thin HT history. */
  baselineSource?: string | null;
  /** True when scored/conceded avgs came from the static baseline (usable even if sample is 0). */
  hasBaselineAvgs?: boolean;
}

export interface HcLeagueHalfAverages {
  sample: number;
  avg1h: number;
  avg2h: number;
  ratio: number;
  source: "computed" | "fallback";
  baselineSource?: string | null;
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
    baselineHome?: string | null;
    baselineAway?: string | null;
    baselineLeague?: string | null;
  };
}

const DEFAULT_HALF_SAMPLE_LIMIT = 15;
const TEAM_BLEND = 0.7;
const LEAGUE_ANCHOR_TEAM = 0.75;
const POISSON_GRID_MAX_GOALS = 5;

/** League defaults when HT samples are thin. PL/LL/SA/L1 from static baselines; Bundesliga kept hard-coded. */
export const LEAGUE_HALF_FALLBACKS: Record<string, { avg1h: number; avg2h: number }> = {
  ...builtInLeagueHalfFallbacks(),
  Bundesliga: { avg1h: 1.22, avg2h: 1.62 },
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
  opts?: { limit?: number; beforeDate?: string; league?: string; season?: string | null }
): HcTeamHalfAverages {
  const limit = opts?.limit ?? DEFAULT_HALF_SAMPLE_LIMIT;
  const samples = collectHalfPairSamples(batches, team, venue, opts).slice(0, limit);
  const liveSample = samples.length;
  const season = opts?.season ?? seasonFromDate(opts?.beforeDate);
  const league = opts?.league ?? "";

  if (liveSample >= HALF_BASELINE_SAMPLE_THRESHOLD) {
    const n = liveSample;
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
      baselineSource: null,
      hasBaselineAvgs: false,
    };
  }

  const row = league ? lookupClubHalfBaseline(team, league, season) : null;
  if (row) {
    const leagueHalf = lookupLeagueHalfBaseline(row.league, row.season);
    const concede1h = leagueHalf ? leagueHalf.avg1h / 2 : row.avg1h;
    const concede2h = leagueHalf ? leagueHalf.avg2h / 2 : row.avg2h;
    return {
      sample: liveSample,
      avg1hScored: row.avg1h,
      avg2hScored: row.avg2h,
      avg1hConceded: concede1h,
      avg2hConceded: concede2h,
      std1hScored: 0,
      std2hScored: 0,
      baselineSource: formatBaselineSource(row),
      hasBaselineAvgs: true,
    };
  }

  if (liveSample === 0) {
    return {
      sample: 0,
      avg1hScored: 0,
      avg2hScored: 0,
      avg1hConceded: 0,
      avg2hConceded: 0,
      std1hScored: 0,
      std2hScored: 0,
      baselineSource: null,
      hasBaselineAvgs: false,
    };
  }

  const n = liveSample;
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
    baselineSource: null,
    hasBaselineAvgs: false,
  };
}

export function computeLeagueHalfAverages(
  batches: PredictionBatch[],
  league: string,
  opts?: { beforeDate?: string; season?: string | null }
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

  const season = opts?.season ?? seasonFromDate(opts?.beforeDate);

  if (sample >= HALF_BASELINE_SAMPLE_THRESHOLD) {
    const avg1h = g1Total / sample;
    const avg2h = g2Total / sample;
    return {
      sample,
      avg1h,
      avg2h,
      ratio: avg2h > 0 ? avg1h / avg2h : 0.75,
      source: "computed",
      baselineSource: null,
    };
  }

  const baseline = lookupLeagueHalfBaseline(league, season);
  if (baseline) {
    return {
      sample,
      avg1h: baseline.avg1h,
      avg2h: baseline.avg2h,
      ratio: baseline.avg2h > 0 ? baseline.avg1h / baseline.avg2h : 0.75,
      source: "fallback",
      baselineSource: baseline.sourceLabel,
    };
  }

  const fb = LEAGUE_HALF_FALLBACKS[league] ?? DEFAULT_LEAGUE_FALLBACK;
  return {
    sample,
    avg1h: fb.avg1h,
    avg2h: fb.avg2h,
    ratio: fb.avg2h > 0 ? fb.avg1h / fb.avg2h : 0.75,
    source: "fallback",
    baselineSource: null,
  };
}

/**
 * Tempo proxies live in half-tempo.ts (shared with merged Half Goals / HSH).
 * Re-exported above for legacy HC callers/tests.
 */

export function computeStageA(params: {
  homeAvg: HcTeamHalfAverages;
  awayAvg: HcTeamHalfAverages;
  leagueAvg: HcLeagueHalfAverages;
  homeTempo: HcTempoProfile;
  awayTempo: HcTempoProfile;
}): HcStageAResult {
  const { homeAvg, awayAvg, leagueAvg, homeTempo, awayTempo } = params;

  // Prefer team avgs when live samples exist or cold-start baseline filled them.
  const useHome = homeAvg.sample > 0 || !!homeAvg.hasBaselineAvgs;
  const useAway = awayAvg.sample > 0 || !!awayAvg.hasBaselineAvgs;
  const h1s = useHome ? homeAvg.avg1hScored : leagueAvg.avg1h / 2;
  const h2s = useHome ? homeAvg.avg2hScored : leagueAvg.avg2h / 2;
  const h1c = useHome ? homeAvg.avg1hConceded : leagueAvg.avg1h / 2;
  const h2c = useHome ? homeAvg.avg2hConceded : leagueAvg.avg2h / 2;
  const a1s = useAway ? awayAvg.avg1hScored : leagueAvg.avg1h / 2;
  const a2s = useAway ? awayAvg.avg2hScored : leagueAvg.avg2h / 2;
  const a1c = useAway ? awayAvg.avg1hConceded : leagueAvg.avg1h / 2;
  const a2c = useAway ? awayAvg.avg2hConceded : leagueAvg.avg2h / 2;

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

  const nudged = applyHalfTempoNudges(
    expH1h + expA1h,
    expH2h + expA2h,
    homeTempo,
    awayTempo
  );

  return {
    expH1h,
    expH2h,
    expA1h,
    expA2h,
    lambda1h: nudged.lambda1h,
    lambda2h: nudged.lambda2h,
    tempoBoost1h: nudged.tempoBoost1h,
    lateSurgeBoost2h: nudged.lateSurgeBoost2h,
    fatigueBoost2h: nudged.fatigueBoost2h,
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
  const recommended =
    params.recommendation === "1h_greater"
      ? "1H"
      : params.recommendation === "2h_greater"
        ? "2H"
        : "Tie";
  return buildHalfGoalsTacticalNote({
    homeTeam: params.homeTeam,
    awayTeam: params.awayTeam,
    homeTempo: params.homeTempo,
    awayTempo: params.awayTempo,
    recommended,
  });
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
  /** Optional clean-sheet rates (0–1); 0 when sample thin / unknown. */
  homeCs1hRate?: number;
  homeCs2hRate?: number;
  awayCs1hRate?: number;
  awayCs2hRate?: number;
}): Record<string, number> {
  const thin = (sample: number, rate: number | undefined) =>
    sample > 0 && rate != null ? rate : 0;
  return {
    home_1h_avg: ctx.homeAvg.avg1hScored,
    home_2h_avg: ctx.homeAvg.avg2hScored,
    away_1h_avg: ctx.awayAvg.avg1hScored,
    away_2h_avg: ctx.awayAvg.avg2hScored,
    home_avg_1h_conceded: ctx.homeAvg.avg1hConceded,
    home_avg_2h_conceded: ctx.homeAvg.avg2hConceded,
    away_avg_1h_conceded: ctx.awayAvg.avg1hConceded,
    away_avg_2h_conceded: ctx.awayAvg.avg2hConceded,
    home_cs_1h_rate: thin(ctx.homeAvg.sample, ctx.homeCs1hRate),
    home_cs_2h_rate: thin(ctx.homeAvg.sample, ctx.homeCs2hRate),
    away_cs_1h_rate: thin(ctx.awayAvg.sample, ctx.awayCs1hRate),
    away_cs_2h_rate: thin(ctx.awayAvg.sample, ctx.awayCs2hRate),
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
  const valueAlert = stageB.p1hGreater > HALF_VALUE_ALERT_1H_THRESHOLD;

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
      baselineHome: ctx.homeAvg.baselineSource ?? null,
      baselineAway: ctx.awayAvg.baselineSource ?? null,
      baselineLeague: ctx.leagueAvg.baselineSource ?? null,
    },
  };
}
