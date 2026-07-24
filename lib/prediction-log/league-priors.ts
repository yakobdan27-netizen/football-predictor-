/**
 * Compact League Priors façade over LeagueCharacterProfile.
 * Research seeds → live/seed profile override → shrinkage + confidence modifiers only.
 * Never blocks markets.
 */
import { resolveLeagueId } from "./league-registry";
import type { League, LeagueCharacterProfile, LeagueProfilesStore, LogMarketKey } from "./types";

/** Match samples at which prior weight reaches ~0 (research §4.3). */
export const LEAGUE_PRIOR_FULL_SAMPLE = 8;

/** Neutral late-goal share (% of matches with a late goal) used as baseline. */
export const LATE_GOAL_SHARE_NEUTRAL = 28;

export type LeaguePriorSource = "seed" | "live" | "blended" | "manual";

export interface LeaguePriorRecord {
  leagueId: string;
  leagueName: string;
  season: string;
  over25_rate: number | null;
  btts_rate: number | null;
  avg_total_corners: number | null;
  home_goal_factor: number | null;
  late_goal_share: number | null;
  sample_size: number;
  source: LeaguePriorSource;
  updatedAt: string;
}

export interface LeaguePriorsStore {
  schemaVersion: number;
  updatedAt: string;
  /** Keyed by leagueId (multi-season compact prior). */
  priors: Record<string, LeaguePriorRecord>;
}

export const LEAGUE_PRIORS_SCHEMA_VERSION = 1;

export type LeaguePriorMarket =
  | "over25"
  | "under25"
  | "btts_yes"
  | "btts_no"
  | "corners_over"
  | "corners_under"
  | "generic";

/**
 * Multi-season research starting priors (2021/22–2025/26).
 * Replaced by system-computed profile values when sample is sufficient.
 */
export const RESEARCH_LEAGUE_PRIOR_SEEDS: Record<string, Omit<LeaguePriorRecord, "updatedAt">> = {
  premier_league: {
    leagueId: "premier_league",
    leagueName: "Premier League",
    season: "2021-26",
    over25_rate: 57.5,
    btts_rate: 54,
    avg_total_corners: 10.4,
    home_goal_factor: 1.18,
    late_goal_share: 30,
    sample_size: 0,
    source: "seed",
  },
  la_liga: {
    leagueId: "la_liga",
    leagueName: "La Liga",
    season: "2021-26",
    over25_rate: 47,
    btts_rate: 48,
    avg_total_corners: 9.55,
    home_goal_factor: 1.14,
    late_goal_share: 27,
    sample_size: 0,
    source: "seed",
  },
  serie_a: {
    leagueId: "serie_a",
    leagueName: "Serie A",
    season: "2021-26",
    over25_rate: 50,
    btts_rate: 50,
    avg_total_corners: 9.8,
    home_goal_factor: 1.12,
    late_goal_share: 28,
    sample_size: 0,
    source: "seed",
  },
  ligue_1: {
    leagueId: "ligue_1",
    leagueName: "Ligue 1",
    season: "2021-26",
    /** Provisional seed until live 2026/27 recompute — do not treat as historical average. */
    over25_rate: 55,
    btts_rate: 52,
    avg_total_corners: 9.9,
    home_goal_factor: 1.22,
    late_goal_share: 36,
    sample_size: 0,
    source: "seed",
  },
  bundesliga: {
    leagueId: "bundesliga",
    leagueName: "Bundesliga",
    season: "2021-26",
    over25_rate: 63.5,
    btts_rate: 59,
    avg_total_corners: 10.6,
    home_goal_factor: 1.3,
    late_goal_share: 30,
    sample_size: 0,
    source: "seed",
  },
};

export function emptyLeaguePriorsStore(): LeaguePriorsStore {
  const now = new Date().toISOString();
  const priors: Record<string, LeaguePriorRecord> = {};
  for (const seed of Object.values(RESEARCH_LEAGUE_PRIOR_SEEDS)) {
    priors[seed.leagueId] = { ...seed, updatedAt: now };
  }
  return {
    schemaVersion: LEAGUE_PRIORS_SCHEMA_VERSION,
    updatedAt: now,
    priors,
  };
}

export function priorWeightFromSample(matchSampleSize: number): number {
  const n = Math.max(0, matchSampleSize);
  return Math.min(1, Math.max(0, 1 - n / LEAGUE_PRIOR_FULL_SAMPLE));
}

/**
 * Blend match signal toward league prior.
 * final = (1 - w) * matchSignal + w * leaguePrior
 */
export function shrinkTowardLeaguePrior(
  matchSignal: number,
  leaguePrior: number,
  matchSampleSize: number
): number {
  if (!Number.isFinite(matchSignal)) return leaguePrior;
  if (!Number.isFinite(leaguePrior)) return matchSignal;
  const w = priorWeightFromSample(matchSampleSize);
  return (1 - w) * matchSignal + w * leaguePrior;
}

function traitValue(profile: LeagueCharacterProfile, key: keyof LeagueCharacterProfile): number | null {
  if (key === "goal_timing_curve") return null;
  const t = profile[key] as { value: number | null; sampleSize?: number; manual?: boolean };
  return t?.value ?? null;
}

function traitSample(profile: LeagueCharacterProfile, key: keyof LeagueCharacterProfile): number {
  if (key === "goal_timing_curve") return 0;
  const t = profile[key] as { sampleSize?: number };
  return t?.sampleSize ?? 0;
}

function anyManual(profile: LeagueCharacterProfile): boolean {
  for (const [k, v] of Object.entries(profile)) {
    if (k === "goal_timing_curve") continue;
    if ((v as { manual?: boolean })?.manual) return true;
  }
  return false;
}

/** Derive home_goal_factor from home advantage index (~1.0–1.4 scale). */
export function deriveHomeGoalFactor(
  homeAdvantageIndex: number | null,
  fallback: number | null
): number | null {
  if (homeAdvantageIndex != null && Number.isFinite(homeAdvantageIndex)) {
    // Index is often ~0–1 or percentage-like; clamp to sensible goal ratio.
    if (homeAdvantageIndex >= 0.5 && homeAdvantageIndex <= 2.5) {
      return Math.round(homeAdvantageIndex * 100) / 100;
    }
    // If stored as 0–100 style rate delta, map lightly around 1.15
    if (homeAdvantageIndex > 2.5) {
      return Math.round((1 + homeAdvantageIndex / 200) * 100) / 100;
    }
  }
  return fallback;
}

export function profileToLeaguePrior(league: League): LeaguePriorRecord {
  const p = league.characterProfile;
  const seed = RESEARCH_LEAGUE_PRIOR_SEEDS[league.leagueId];
  const over = traitValue(p, "over_2_5_rate");
  const btts = traitValue(p, "btts_rate");
  const corners = traitValue(p, "corners_per_match_avg");
  const late = traitValue(p, "late_goal_rate_80_90");
  const homeAdv = traitValue(p, "home_advantage_index");

  const sample = Math.max(
    league.matchesLogged,
    traitSample(p, "over_2_5_rate"),
    traitSample(p, "btts_rate"),
    traitSample(p, "corners_per_match_avg"),
    seed?.sample_size ?? 0
  );

  let source: LeaguePriorSource = league.dataSource ?? "blended";
  if (anyManual(p)) source = "manual";

  return {
    leagueId: league.leagueId,
    leagueName: league.leagueName,
    season: league.season,
    over25_rate: over ?? seed?.over25_rate ?? null,
    btts_rate: btts ?? seed?.btts_rate ?? null,
    avg_total_corners: corners ?? seed?.avg_total_corners ?? null,
    home_goal_factor: deriveHomeGoalFactor(homeAdv, seed?.home_goal_factor ?? null),
    late_goal_share: late ?? seed?.late_goal_share ?? null,
    sample_size: sample,
    source,
    updatedAt: league.lastUpdated || new Date().toISOString(),
  };
}

/** Prefer richest sample among seasons for a leagueId. */
export function compactPriorsFromProfiles(store: LeagueProfilesStore): LeaguePriorsStore {
  const byId = new Map<string, LeaguePriorRecord>();
  for (const league of Object.values(store.leagues)) {
    const prior = profileToLeaguePrior(league);
    const existing = byId.get(prior.leagueId);
    if (!existing || prior.sample_size >= existing.sample_size) {
      byId.set(prior.leagueId, prior);
    }
  }

  // Ensure research seeds exist for big five even with empty profiles
  const now = new Date().toISOString();
  for (const seed of Object.values(RESEARCH_LEAGUE_PRIOR_SEEDS)) {
    if (!byId.has(seed.leagueId)) {
      byId.set(seed.leagueId, { ...seed, updatedAt: now });
    }
  }

  return {
    schemaVersion: LEAGUE_PRIORS_SCHEMA_VERSION,
    updatedAt: store.updatedAt || now,
    priors: Object.fromEntries(byId),
  };
}

export function resolvePriorFromStore(
  store: LeaguePriorsStore | null | undefined,
  leagueIdOrName: string
): LeaguePriorRecord | null {
  if (!store?.priors) return null;
  const id = resolveLeagueId(leagueIdOrName);
  return store.priors[id] ?? store.priors[leagueIdOrName] ?? null;
}

export function resolvePriorWithSeedFallback(leagueIdOrName: string): LeaguePriorRecord {
  const id = resolveLeagueId(leagueIdOrName);
  const seed = RESEARCH_LEAGUE_PRIOR_SEEDS[id];
  if (seed) {
    return { ...seed, updatedAt: new Date().toISOString() };
  }
  return {
    leagueId: id,
    leagueName: leagueIdOrName,
    season: "2021-26",
    over25_rate: 50,
    btts_rate: 50,
    avg_total_corners: 9.8,
    home_goal_factor: 1.15,
    late_goal_share: LATE_GOAL_SHARE_NEUTRAL,
    sample_size: 0,
    source: "seed",
    updatedAt: new Date().toISOString(),
  };
}

export function marketPriorValue(
  prior: LeaguePriorRecord,
  market: LeaguePriorMarket
): number | null {
  switch (market) {
    case "over25":
      return prior.over25_rate;
    case "under25":
      return prior.over25_rate != null ? 100 - prior.over25_rate : null;
    case "btts_yes":
      return prior.btts_rate;
    case "btts_no":
      return prior.btts_rate != null ? 100 - prior.btts_rate : null;
    case "corners_over":
      // Soft: above ~9.5 avg → lean Over confidence proxy
      if (prior.avg_total_corners == null) return null;
      return Math.min(70, Math.max(35, 40 + (prior.avg_total_corners - 9.5) * 8));
    case "corners_under":
      if (prior.avg_total_corners == null) return null;
      return Math.min(70, Math.max(35, 40 + (9.5 - prior.avg_total_corners) * 8));
    default:
      return prior.over25_rate;
  }
}

export function inferPriorMarket(
  marketKey: string,
  prediction?: string | null
): LeaguePriorMarket {
  const pred = (prediction ?? "").toLowerCase();
  const key = marketKey.toLowerCase();

  if (key.includes("btts")) {
    if (pred.includes("no")) return "btts_no";
    return "btts_yes";
  }
  if (key.includes("corner")) {
    if (pred.includes("under")) return "corners_under";
    return "corners_over";
  }
  if (
    key.includes("total_goals") ||
    key.includes("over_under") ||
    key === "total_goals_ou" ||
    key.includes("goals_ou")
  ) {
    if (pred.includes("under")) return "under25";
    return "over25";
  }
  if (pred.includes("under")) return "under25";
  if (pred.includes("over")) return "over25";
  return "generic";
}

export function inferPriorMarketFromLogKey(
  marketKey: LogMarketKey,
  prediction?: string | null
): LeaguePriorMarket {
  return inferPriorMarket(marketKey, prediction);
}

export interface LeaguePriorLookupResult {
  prior: LeaguePriorRecord;
  priorWeight: number;
  marketValue: number | null;
  sampleSize: number;
}

/**
 * Resolve prior + weight for a league/market.
 * `matchSampleSize` drives shrinkage weight (more data → less prior).
 */
export function getLeaguePrior(
  leagueIdOrName: string,
  opts?: {
    store?: LeaguePriorsStore | null;
    season?: string;
    market?: LeaguePriorMarket;
    matchSampleSize?: number;
  }
): LeaguePriorLookupResult {
  const fromStore = resolvePriorFromStore(opts?.store, leagueIdOrName);
  const prior = fromStore ?? resolvePriorWithSeedFallback(leagueIdOrName);
  const matchSample = opts?.matchSampleSize ?? 0;
  const market = opts?.market ?? "generic";
  return {
    prior,
    priorWeight: priorWeightFromSample(matchSample),
    marketValue: marketPriorValue(prior, market),
    sampleSize: prior.sample_size,
  };
}

/** Scale late-surge / fatigue multipliers using league late_goal_share. */
export function lateGoalTempoScale(lateGoalShare: number | null | undefined): number {
  if (lateGoalShare == null || !Number.isFinite(lateGoalShare)) return 1;
  // ~28 neutral → 1.0; Ligue 1 ~36 → ~1.06; low ~22 → ~0.96
  const scale = 1 + (lateGoalShare - LATE_GOAL_SHARE_NEUTRAL) / 140;
  return Math.min(1.12, Math.max(0.94, scale));
}

export interface PriorConfidenceModifier {
  confidence: number;
  priorAlign: number; // -1 fights, 0 neutral, +1 aligned
  warn?: string;
}

const PRIOR_NUDGE = 4;

/**
 * Small confidence nudge when a DM candidate aligns with / fights the league prior.
 * Never blocks — only adjusts displayed confidence.
 */
export function applyLeaguePriorConfidenceModifier(
  confidence: number,
  prediction: string,
  marketKey: string,
  prior: LeaguePriorRecord | null
): PriorConfidenceModifier {
  if (!prior) {
    return { confidence, priorAlign: 0 };
  }
  const market = inferPriorMarket(marketKey, prediction);
  const value = marketPriorValue(prior, market);
  if (value == null) return { confidence, priorAlign: 0 };

  // Align if prior rate >= 52 for the predicted side; fight if opposite side >= 55
  let priorAlign = 0;
  let warn: string | undefined;

  if (market === "over25" || market === "btts_yes" || market === "corners_over") {
    if (value >= 52) priorAlign = 1;
    else if (value <= 45) {
      priorAlign = -1;
      warn = `Fights ${prior.leagueName} prior (${value.toFixed(0)}% for this side)`;
    }
  } else if (market === "under25" || market === "btts_no" || market === "corners_under") {
    if (value >= 52) priorAlign = 1;
    else if (value <= 45) {
      priorAlign = -1;
      warn = `Fights ${prior.leagueName} prior (${value.toFixed(0)}% for this side)`;
    }
  }

  const nudged = Math.min(100, Math.max(0, confidence + priorAlign * PRIOR_NUDGE));
  return { confidence: Math.round(nudged * 10) / 10, priorAlign, warn };
}
