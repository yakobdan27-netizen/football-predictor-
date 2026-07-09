import { BAYESIAN_CONFIG } from "./bayesian-config";
import { betaMean, gammaMean } from "./bayesian-update";
import type { BetaPosterior, ClubRecord, GammaPosterior } from "./club-record-types";
import { getLeagueBaseline, type LeagueBaselinesStore } from "./league-baselines";
import { pickProbFromMatrix } from "./statistics-engine";
import { STAT_ENGINE_CONFIG } from "./stat-engine-config";
import { buildScoreMatrix, marketProbsFromMatrix } from "@/lib/predictor/score-matrix";
import { lookupTeam, tierBoostPercent } from "./teams-quality";
import type { TeamsQualityStore } from "./teams-quality-types";
import type { LogMarketKey } from "./types";

export interface BayesianMarketEstimate {
  point: number;
  lo: number;
  hi: number;
  intervalWidth: number;
  confidence: number;
}

export interface BayesianMatchResult {
  lambdaHome: number;
  lambdaAway: number;
  marketEstimates: Partial<Record<LogMarketKey | string, BayesianMarketEstimate>>;
  scoreGridMean: number[][];
  credibleLevel: number;
  posteriorSummary: {
    homeAttack: number;
    homeDefense: number;
    awayAttack: number;
    awayDefense: number;
  };
}

function randn(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sampleGamma(shape: number, rate: number): number {
  if (shape <= 0 || rate <= 0) return 0;
  if (shape < 1) {
    const boosted = sampleGamma(1 + shape, rate);
    return boosted * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number;
    let v: number;
    do {
      x = randn();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return (d * v) / rate;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return (d * v) / rate;
  }
}

function getGammaRate(
  record: ClubRecord | null,
  key: "goals_scored_home" | "goals_scored_away" | "goals_conceded_home" | "goals_conceded_away",
  fallback: number
): { mean: number; shape: number; rate: number } {
  const state = record?.bayesianMarkets?.markets[key];
  if (state?.type === "gamma") {
    return {
      mean: gammaMean(state),
      shape: state.posterior.shape,
      rate: state.posterior.rate,
    };
  }
  const shape = BAYESIAN_CONFIG.GAMMA_PRIOR_DEFAULT.shape;
  const rate = BAYESIAN_CONFIG.GAMMA_PRIOR_DEFAULT.rate;
  return { mean: fallback, shape, rate };
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

function confidenceFromWidth(width: number, level: number): number {
  const maxWidth = level >= 0.9 ? 0.6 : 0.5;
  return Math.max(0, Math.min(1, 1 - width / maxWidth));
}

export function computeBayesianLambdas(
  homeRecord: ClubRecord | null,
  awayRecord: ClubRecord | null,
  league: string,
  leagueBaselines: LeagueBaselinesStore | null,
  teamsQuality: TeamsQualityStore | null
): { lambdaHome: number; lambdaAway: number; summary: BayesianMatchResult["posteriorSummary"] } {
  const baseline = getLeagueBaseline(leagueBaselines, league, {
    home: STAT_ENGINE_CONFIG.DEFAULT_LEAGUE_HOME_GOALS,
    away: STAT_ENGINE_CONFIG.DEFAULT_LEAGUE_AWAY_GOALS,
  });

  const homeAttackHome = getGammaRate(homeRecord, "goals_scored_home", baseline.league_avg_home_goals);
  const homeAttackAway = getGammaRate(homeRecord, "goals_scored_away", baseline.league_avg_away_goals);
  const awayAttackHome = getGammaRate(awayRecord, "goals_scored_home", baseline.league_avg_home_goals);
  const awayAttackAway = getGammaRate(awayRecord, "goals_scored_away", baseline.league_avg_away_goals);
  const homeDefHome = getGammaRate(homeRecord, "goals_conceded_home", baseline.league_avg_away_goals);
  const homeDefAway = getGammaRate(homeRecord, "goals_conceded_away", baseline.league_avg_home_goals);
  const awayDefHome = getGammaRate(awayRecord, "goals_conceded_home", baseline.league_avg_away_goals);
  const awayDefAway = getGammaRate(awayRecord, "goals_conceded_away", baseline.league_avg_home_goals);

  const homeAttack = (homeAttackHome.mean + homeAttackAway.mean) / 2;
  const awayAttack = (awayAttackHome.mean + awayAttackAway.mean) / 2;
  const homeDefense = (homeDefHome.mean + homeDefAway.mean) / 2;
  const awayDefense = (awayDefHome.mean + awayDefAway.mean) / 2;

  let lambdaHome =
    BAYESIAN_CONFIG.HOME_ADVANTAGE *
    homeAttack *
    (awayDefense > 0 ? baseline.league_avg_home_goals / awayDefense : 1);
  let lambdaAway =
    BAYESIAN_CONFIG.AWAY_FACTOR *
    awayAttack *
    (homeDefense > 0 ? baseline.league_avg_away_goals / homeDefense : 1);

  const homeTier = lookupTeam(teamsQuality, homeRecord?.clubName ?? "");
  const awayTier = lookupTeam(teamsQuality, awayRecord?.clubName ?? "");
  if (homeTier && awayTier && teamsQuality) {
    const boostPct = tierBoostPercent(
      homeTier.tier_rank,
      awayTier.tier_rank,
      teamsQuality.boost_per_tier_gap,
      teamsQuality.max_boost
    );
    lambdaHome *= 1 + boostPct / 100;
    lambdaAway *= 1 - (boostPct / 100) * 0.5;
  }

  return {
    lambdaHome: Math.max(0.05, lambdaHome),
    lambdaAway: Math.max(0.05, lambdaAway),
    summary: {
      homeAttack,
      homeDefense,
      awayAttack,
      awayDefense,
    },
  };
}

export function computeBayesianMatchPrediction(
  homeRecord: ClubRecord | null,
  awayRecord: ClubRecord | null,
  league: string,
  leagueBaselines: LeagueBaselinesStore | null,
  teamsQuality: TeamsQualityStore | null,
  marketKey: LogMarketKey = "1x2",
  prediction = "home",
  line?: number,
  sampleCount: number = BAYESIAN_CONFIG.MONTE_CARLO_SAMPLES
): BayesianMatchResult {
  const baseline = getLeagueBaseline(leagueBaselines, league, {
    home: STAT_ENGINE_CONFIG.DEFAULT_LEAGUE_HOME_GOALS,
    away: STAT_ENGINE_CONFIG.DEFAULT_LEAGUE_AWAY_GOALS,
  });

  const homeAtkH = getGammaRate(homeRecord, "goals_scored_home", baseline.league_avg_home_goals);
  const awayAtkA = getGammaRate(awayRecord, "goals_scored_away", baseline.league_avg_away_goals);
  const homeDefH = getGammaRate(homeRecord, "goals_conceded_home", baseline.league_avg_away_goals);
  const awayDefA = getGammaRate(awayRecord, "goals_conceded_away", baseline.league_avg_home_goals);

  const pointLambdas = computeBayesianLambdas(
    homeRecord,
    awayRecord,
    league,
    leagueBaselines,
    teamsQuality
  );

  const marketSamples: number[] = [];
  const gridSize = STAT_ENGINE_CONFIG.SCORE_GRID_MAX + 1;
  const gridSum = Array.from({ length: gridSize }, () => Array(gridSize).fill(0));

  for (let i = 0; i < sampleCount; i++) {
    const hAtk = sampleGamma(homeAtkH.shape, homeAtkH.rate);
    const aAtk = sampleGamma(awayAtkA.shape, awayAtkA.rate);
    const hDef = sampleGamma(homeDefH.shape, homeDefH.rate);
    const aDef = sampleGamma(awayDefA.shape, awayDefA.rate);

    let lamH =
      BAYESIAN_CONFIG.HOME_ADVANTAGE *
      hAtk *
      (aDef > 0 ? baseline.league_avg_home_goals / aDef : 1);
    let lamA =
      BAYESIAN_CONFIG.AWAY_FACTOR *
      aAtk *
      (hDef > 0 ? baseline.league_avg_away_goals / hDef : 1);
    lamH = Math.max(0.05, lamH);
    lamA = Math.max(0.05, lamA);

    const grid = buildScoreMatrix(
      lamH,
      lamA,
      STAT_ENGINE_CONFIG.DIXON_COLES_RHO,
      STAT_ENGINE_CONFIG.SCORE_GRID_MAX
    );
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        gridSum[r]![c]! += grid[r]![c]!;
      }
    }

    const probs = marketProbsFromMatrix(grid);
    marketSamples.push(pickProbFromMatrix(probs, marketKey, prediction, line));
  }

  const sorted = [...marketSamples].sort((a, b) => a - b);
  const alpha = (1 - BAYESIAN_CONFIG.CREDIBLE_LEVEL) / 2;
  const lo = percentile(sorted, alpha);
  const hi = percentile(sorted, 1 - alpha);
  const point = marketSamples.reduce((a, b) => a + b, 0) / marketSamples.length;
  const width = hi - lo;

  const scoreGridMean = gridSum.map((row) => row.map((v) => v / sampleCount));

  const marketEstimates: BayesianMatchResult["marketEstimates"] = {
    [marketKey]: {
      point,
      lo,
      hi,
      intervalWidth: width,
      confidence: confidenceFromWidth(width, BAYESIAN_CONFIG.CREDIBLE_LEVEL),
    },
  };

  for (const mk of ["1x2", "btts", "double_chance"] as LogMarketKey[]) {
    if (mk === marketKey) continue;
    const samples: number[] = [];
    for (let i = 0; i < Math.min(400, sampleCount); i++) {
      const hAtk = sampleGamma(homeAtkH.shape, homeAtkH.rate);
      const aAtk = sampleGamma(awayAtkA.shape, awayAtkA.rate);
      const hDef = sampleGamma(homeDefH.shape, homeDefH.rate);
      const aDef = sampleGamma(awayDefA.shape, awayDefA.rate);
      let lamH = BAYESIAN_CONFIG.HOME_ADVANTAGE * hAtk * (aDef > 0 ? baseline.league_avg_home_goals / aDef : 1);
      let lamA = BAYESIAN_CONFIG.AWAY_FACTOR * aAtk * (hDef > 0 ? baseline.league_avg_away_goals / hDef : 1);
      const grid = buildScoreMatrix(
        Math.max(0.05, lamH),
        Math.max(0.05, lamA),
        STAT_ENGINE_CONFIG.DIXON_COLES_RHO,
        STAT_ENGINE_CONFIG.SCORE_GRID_MAX
      );
      const probs = marketProbsFromMatrix(grid);
      const pred = mk === "1x2" ? "home" : mk === "btts" ? "yes" : "1x";
      samples.push(pickProbFromMatrix(probs, mk, pred, line));
    }
    const s = [...samples].sort((a, b) => a - b);
    const p = samples.reduce((a, b) => a + b, 0) / samples.length;
    const w = percentile(s, 1 - alpha) - percentile(s, alpha);
    marketEstimates[mk] = {
      point: p,
      lo: percentile(s, alpha),
      hi: percentile(s, 1 - alpha),
      intervalWidth: w,
      confidence: confidenceFromWidth(w, BAYESIAN_CONFIG.CREDIBLE_LEVEL),
    };
  }

  return {
    lambdaHome: pointLambdas.lambdaHome,
    lambdaAway: pointLambdas.lambdaAway,
    marketEstimates,
    scoreGridMean,
    credibleLevel: BAYESIAN_CONFIG.CREDIBLE_LEVEL,
    posteriorSummary: pointLambdas.summary,
  };
}

export function getPosteriorMeansForDisplay(record: ClubRecord | null): Array<{
  key: string;
  mean: number;
  n: number;
  type: "gamma" | "beta";
}> {
  if (!record?.bayesianMarkets) return [];
  const out: Array<{ key: string; mean: number; n: number; type: "gamma" | "beta" }> = [];
  for (const [key, state] of Object.entries(record.bayesianMarkets.markets)) {
    if (!state) continue;
    if (state.type === "gamma") {
      out.push({ key, mean: gammaMean(state), n: state.n, type: "gamma" });
    } else {
      out.push({ key, mean: betaMean(state as BetaPosterior), n: state.n, type: "beta" });
    }
  }
  return out;
}

export { confidenceFromWidth };
