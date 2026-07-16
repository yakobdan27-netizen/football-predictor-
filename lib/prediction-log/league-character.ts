import type { League, LeagueCharacterProfile, LeagueCharacterTrait, LogMarketKey } from "./types";

export const LEAGUE_ADJUST_CAP = 0.08;
const MIN_SAMPLE = 5;

function traitValue(profile: LeagueCharacterProfile, key: keyof LeagueCharacterProfile): number | null {
  if (key === "goal_timing_curve") return null;
  const t = profile[key] as LeagueCharacterTrait;
  if (t.sampleSize < MIN_SAMPLE || t.value == null) return null;
  return t.baselineDelta ?? 0;
}

function clampPct(n: number): number {
  return Math.max(5, Math.min(95, Math.round(n)));
}

export function leagueDeltaForMarket(
  profile: LeagueCharacterProfile | null | undefined,
  marketKey: LogMarketKey
): number {
  if (!profile) return 0;
  let delta = 0;
  if (marketKey === "btts") delta += (traitValue(profile, "btts_rate") ?? 0) * 0.003;
  if (marketKey === "1x2" || marketKey === "double_chance") {
    delta += (traitValue(profile, "favourite_reliability") ?? 0) * 0.002;
    delta += (traitValue(profile, "home_advantage_index") ?? 0) * 0.05;
  }
  if (
    marketKey === "handicap" ||
    marketKey === "ht_handicap" ||
    marketKey === "three_way_handicap"
  ) {
    delta += (traitValue(profile, "favourite_reliability") ?? 0) * 0.002;
    delta += (traitValue(profile, "home_advantage_index") ?? 0) * 0.04;
  }
  if (
    marketKey === "home_goals_ou" ||
    marketKey === "away_goals_ou" ||
    marketKey === "total_goals_ou" ||
    marketKey === "shots_ou" ||
    marketKey === "home_shots_ou" ||
    marketKey === "away_shots_ou" ||
    marketKey === "sot_ou" ||
    marketKey === "home_sot_ou" ||
    marketKey === "away_sot_ou" ||
    marketKey === "corners_ou" ||
    marketKey === "offsides_ou"
  ) {
    delta += (traitValue(profile, "goals_per_match_avg") ?? 0) * 0.02;
    delta += (traitValue(profile, "tempo_index") ?? 0) * 0.001;
  }
  if (marketKey === "ht_1x2" || marketKey === "more_goals_half" || marketKey === "ht_handicap") {
    delta += (traitValue(profile, "half_dominance") ?? 0) * 0.03;
  }
  return Math.max(-LEAGUE_ADJUST_CAP, Math.min(LEAGUE_ADJUST_CAP, delta));
}

export function applyLeagueAdjustToPSignal(
  pSignal: number,
  profile: LeagueCharacterProfile | null | undefined,
  marketKey: LogMarketKey
): { pSignal: number; audit?: { trait: string; delta: number; appliedPct: number } } {
  const delta = leagueDeltaForMarket(profile, marketKey);
  if (delta === 0) return { pSignal };
  const adjusted = clampPct(pSignal * (1 + delta));
  return {
    pSignal: adjusted,
    audit: { trait: marketKey, delta, appliedPct: adjusted - pSignal },
  };
}

export function scaleLambdasForLeague(
  lambdaHome: number,
  lambdaAway: number,
  profile: LeagueCharacterProfile | null | undefined,
  leagueGoalsAvg?: number
): { lambdaHome: number; lambdaAway: number } {
  if (!profile) return { lambdaHome, lambdaAway };
  const g = profile.goals_per_match_avg;
  if (g.value == null || g.sampleSize < MIN_SAMPLE) return { lambdaHome, lambdaAway };
  const target = g.value / 2;
  const current = lambdaHome + lambdaAway;
  if (current <= 0) return { lambdaHome, lambdaAway };
  const scale = Math.max(0.85, Math.min(1.15, (leagueGoalsAvg ?? g.value) / current));
  return {
    lambdaHome: lambdaHome * scale,
    lambdaAway: lambdaAway * scale,
  };
}

export function tierBoostScaleFromLeague(profile: LeagueCharacterProfile | null | undefined): number {
  const fr = profile?.favourite_reliability;
  if (!fr || fr.value == null || fr.sampleSize < MIN_SAMPLE) return 1;
  if (fr.value >= 65) return 1;
  if (fr.value <= 45) return 0.6;
  return 0.6 + ((fr.value - 45) / 20) * 0.4;
}

export function intervalWidthScaleFromLeague(profile: LeagueCharacterProfile | null | undefined): number {
  const sp = profile?.scoreline_predictability;
  if (!sp || sp.value == null || sp.sampleSize < MIN_SAMPLE) return 1;
  if (sp.value >= 60) return 1;
  if (sp.value <= 30) return 1.4;
  return 1 + ((60 - sp.value) / 30) * 0.4;
}

export function describeEngineImpact(
  league: League | null
): Array<{ market: string; adjustment: string }> {
  if (!league || league.confidenceLevel === "low") {
    return [{ market: "All", adjustment: "Insufficient league data — no adjustment applied." }];
  }
  const p = league.characterProfile;
  const rows: Array<{ market: string; adjustment: string }> = [];
  const push = (market: string, trait: keyof LeagueCharacterProfile, label: string) => {
    if (trait === "goal_timing_curve") return;
    const t = p[trait] as LeagueCharacterTrait;
    if (t.baselineDelta == null || t.sampleSize < MIN_SAMPLE) return;
    const dir = t.baselineDelta > 0 ? "↑" : "↓";
    rows.push({ market, adjustment: `${label} ${dir} (${t.baselineDelta > 0 ? "+" : ""}${t.baselineDelta})` });
  };
  push("BTTS", "btts_rate", "BTTS tendency");
  push("1X2 / Double chance", "favourite_reliability", "Favourite reliability");
  push("Goal markets", "goals_per_match_avg", "Goal volume");
  push("Half markets", "half_dominance", "Half dominance");
  push("Tier boost", "favourite_reliability", "A–D tier scaling");
  push("Bayesian intervals", "scoreline_predictability", "Interval width");
  return rows.length ? rows : [{ market: "All", adjustment: "Neutral — league near baseline." }];
}
