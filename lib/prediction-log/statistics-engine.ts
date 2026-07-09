import type { LogMarketKey, LeagueCharacterProfile } from "./types";
import type { ClubRecord, ClubStatMetadata } from "./club-record-types";
import { getLeagueBaseline, type LeagueBaselinesStore } from "./league-baselines";
import { scaleLambdasForLeague } from "./league-character";
import { STAT_ENGINE_CONFIG } from "./stat-engine-config";
import {
  buildScoreMatrix,
  marketProbsFromMatrix,
  type MatrixMarketProbs,
} from "@/lib/predictor/score-matrix";

export interface DixonColesResult {
  scoreGrid: number[][];
  lambdaHome: number;
  lambdaAway: number;
  marketProb: number;
  marketProbs: MatrixMarketProbs;
}

function metaOrDefault(meta: ClubStatMetadata | undefined): ClubStatMetadata {
  if (meta) return meta;
  return {
    attack_strength_home: 1,
    attack_strength_away: 1,
    defense_strength_home: 1,
    defense_strength_away: 1,
    goals_for_rolling: 0,
    goals_against_rolling: 0,
    xg_for: 0,
    xg_against: 0,
    form_points: 0,
    tier: null,
    sample_size: 0,
    lastUpdated: "",
  };
}

export function computeLambdas(
  homeMeta: ClubStatMetadata | undefined,
  awayMeta: ClubStatMetadata | undefined,
  leagueBaselines: LeagueBaselinesStore | null,
  league: string,
  leagueCharacterProfile?: LeagueCharacterProfile | null
): { lambdaHome: number; lambdaAway: number } {
  const home = metaOrDefault(homeMeta);
  const away = metaOrDefault(awayMeta);
  const baseline = getLeagueBaseline(leagueBaselines, league, {
    home: STAT_ENGINE_CONFIG.DEFAULT_LEAGUE_HOME_GOALS,
    away: STAT_ENGINE_CONFIG.DEFAULT_LEAGUE_AWAY_GOALS,
  });

  const defenseWeaknessAway = away.defense_strength_away > 0 ? 1 / away.defense_strength_away : 1;
  const defenseWeaknessHome = home.defense_strength_home > 0 ? 1 / home.defense_strength_home : 1;

  let lambdaHome =
    baseline.league_avg_home_goals * home.attack_strength_home * defenseWeaknessAway;
  let lambdaAway =
    baseline.league_avg_away_goals * away.attack_strength_away * defenseWeaknessHome;

  const scaled = scaleLambdasForLeague(
    Math.max(0.05, lambdaHome),
    Math.max(0.05, lambdaAway),
    leagueCharacterProfile ?? null,
    baseline.league_avg_home_goals + baseline.league_avg_away_goals
  );

  return {
    lambdaHome: scaled.lambdaHome,
    lambdaAway: scaled.lambdaAway,
  };
}

export function pickProbFromMatrix(
  probs: MatrixMarketProbs,
  marketKey: LogMarketKey,
  prediction: string,
  line?: number
): number {
  const p = prediction.toLowerCase().trim();

  if (marketKey === "1x2" || marketKey === "ht_1x2") {
    if (p === "home" || p === "1" || p === "h") return probs.home;
    if (p === "away" || p === "2" || p === "a") return probs.away;
    return probs.draw;
  }
  if (marketKey === "double_chance") {
    if (p === "1x" || p === "1x") return probs.doubleChance.oneX;
    if (p === "x2") return probs.doubleChance.xTwo;
    if (p === "12") return probs.doubleChance.oneTwo;
    return probs.doubleChance.oneX;
  }
  if (marketKey === "btts") {
    if (p === "yes" || p === "over") return probs.bttsYes;
    return probs.bttsNo;
  }
  const lineKey = line != null ? String(line) : "2.5";
  const ou = probs.overUnder[lineKey] ?? probs.overUnder["2.5"];
  if (!ou) return 0.5;
  if (p === "over") return ou.over;
  return ou.under;
}

export function computeDixonColes(
  homeRecord: ClubRecord | null,
  awayRecord: ClubRecord | null,
  league: string,
  marketKey: LogMarketKey,
  prediction: string,
  line: number | undefined,
  leagueBaselines: LeagueBaselinesStore | null,
  leagueCharacterProfile?: LeagueCharacterProfile | null
): DixonColesResult {
  const { lambdaHome, lambdaAway } = computeLambdas(
    homeRecord?.statMetadata,
    awayRecord?.statMetadata,
    leagueBaselines,
    league,
    leagueCharacterProfile
  );

  const scoreGrid = buildScoreMatrix(
    lambdaHome,
    lambdaAway,
    STAT_ENGINE_CONFIG.DIXON_COLES_RHO,
    STAT_ENGINE_CONFIG.SCORE_GRID_MAX
  );
  const marketProbs = marketProbsFromMatrix(scoreGrid);
  const marketProb = pickProbFromMatrix(marketProbs, marketKey, prediction, line);

  return { scoreGrid, lambdaHome, lambdaAway, marketProb, marketProbs };
}

export function dcProbToPercent(prob: number): number {
  return Math.round(Math.max(0, Math.min(100, prob * 100)));
}
