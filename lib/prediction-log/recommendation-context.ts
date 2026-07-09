import { flattenScoredRows } from "./analysis";
import {
  HIGH_VARIANCE_WIN_RATE_THRESHOLD,
  isHighVarianceMarket,
  LOW_WIN_RATE_THRESHOLD,
  MIN_SAMPLE_FOR_ACTION,
  MIN_TEAM_SAMPLE,
} from "./recommendation-config";
import type { OddsBandId, AnalysisHistory, LogMarketKey, PredictionBatch, ClubProfilesStore } from "./types";
import type { ClubIndex, ClubRecord, MatchupCache } from "./club-record-types";
import type { LeagueBaselinesStore } from "./league-baselines";
import type { MlClassifierStore } from "./ml-model-store";
import type { TeamsQualityStore } from "./teams-quality-types";
import type { LeagueCharacterProfile, LeagueProfilesStore } from "./types";
import { resolveLeagueCharacterProfile } from "./league-profiles";

export interface RateLookup {
  pct: number | null;
  sample: number;
  lowSample: boolean;
}

export interface RecommendationContext {
  analysis: AnalysisHistory;
  hasHistory: boolean;
  league: string;
  teamRows: ReturnType<typeof flattenScoredRows>;
  clubProfiles: ClubProfilesStore | null;
  clubRecords?: Record<string, ClubRecord> | null;
  clubIndex?: ClubIndex | null;
  leagueBaselines?: LeagueBaselinesStore | null;
  mlClassifier?: MlClassifierStore | null;
  teamsQuality?: TeamsQualityStore | null;
  leagueProfiles?: LeagueProfilesStore | null;
  leagueCharacterProfile?: LeagueCharacterProfile | null;
  matchupCaches?: Record<string, MatchupCache>;
  allBatches?: PredictionBatch[];
}

export function buildRecommendationContext(
  original: PredictionBatch,
  allBatches: PredictionBatch[],
  analysis: AnalysisHistory,
  clubProfiles: ClubProfilesStore | null = null,
  clubRecords: Record<string, ClubRecord> | null = null,
  clubIndex: ClubIndex | null = null,
  extras?: {
    leagueBaselines?: LeagueBaselinesStore | null;
    mlClassifier?: MlClassifierStore | null;
    teamsQuality?: TeamsQualityStore | null;
    leagueProfiles?: LeagueProfilesStore | null;
    matchupCaches?: Record<string, MatchupCache>;
  }
): RecommendationContext {
  const teamRows = flattenScoredRows(
    allBatches.filter((b) => b.id !== original.id)
  );
  const leagueProfiles = extras?.leagueProfiles ?? null;
  return {
    analysis,
    hasHistory: analysis.totalScored > 0,
    league: original.league,
    teamRows,
    clubProfiles,
    clubRecords,
    clubIndex,
    leagueBaselines: extras?.leagueBaselines ?? null,
    mlClassifier: extras?.mlClassifier ?? null,
    teamsQuality: extras?.teamsQuality ?? null,
    leagueProfiles,
    leagueCharacterProfile: resolveLeagueCharacterProfile(
      leagueProfiles,
      original.league,
      original.date
    ),
    matchupCaches: extras?.matchupCaches ?? {},
    allBatches,
  };
}

export function getMarketRate(
  ctx: RecommendationContext,
  league: string,
  market: LogMarketKey
): RateLookup {
  const stats = ctx.analysis.leagueAccuracy[league]?.[market];
  if (!stats) return { pct: null, sample: 0, lowSample: true };
  const sample = stats.correct + stats.wrong;
  return {
    pct: stats.pct,
    sample,
    lowSample: sample < MIN_SAMPLE_FOR_ACTION,
  };
}

export function getGlobalMarketRate(
  ctx: RecommendationContext,
  market: LogMarketKey
): RateLookup {
  const stats = ctx.analysis.marketAccuracy[market];
  if (!stats) return { pct: null, sample: 0, lowSample: true };
  const sample = stats.correct + stats.wrong;
  return {
    pct: stats.pct,
    sample,
    lowSample: sample < MIN_SAMPLE_FOR_ACTION,
  };
}

export function getOddsBandRate(ctx: RecommendationContext, band: OddsBandId): RateLookup {
  const recent = ctx.analysis.oddsAnalysis.recentBands[band];
  const recentSample = recent.wins + recent.losses;
  const useRecent =
    recentSample >= MIN_SAMPLE_FOR_ACTION && !recent.lowSample && recent.winRate != null;
  const source = useRecent ? recent : ctx.analysis.oddsAnalysis.bands[band];
  const sample = source.wins + source.losses;
  return {
    pct: source.winRate,
    sample,
    lowSample: sample < MIN_SAMPLE_FOR_ACTION,
  };
}

export function getTeamPickRate(
  ctx: RecommendationContext,
  home: string,
  away: string,
  market: LogMarketKey,
  prediction: string
): RateLookup {
  const rows = ctx.teamRows.filter(
    (r) =>
      r.market === market &&
      r.prediction === prediction &&
      (r.homeTeam === home || r.awayTeam === away || r.homeTeam === away || r.awayTeam === home) &&
      (r.result === "correct" || r.result === "wrong")
  );
  const wins = rows.filter((r) => r.result === "correct").length;
  const losses = rows.filter((r) => r.result === "wrong").length;
  const sample = wins + losses;
  return {
    pct: sample > 0 ? Math.round((wins / sample) * 100) : null,
    sample,
    lowSample: sample < MIN_TEAM_SAMPLE,
  };
}

export function getMarketTier(market: LogMarketKey): "normal" | "high_variance" {
  return isHighVarianceMarket(market) ? "high_variance" : "normal";
}

export function isLowWinRate(rate: RateLookup, market: LogMarketKey): boolean {
  if (rate.lowSample || rate.pct == null) return false;
  const threshold = isHighVarianceMarket(market)
    ? HIGH_VARIANCE_WIN_RATE_THRESHOLD
    : LOW_WIN_RATE_THRESHOLD;
  return rate.pct < threshold;
}

export function capConfidence(original: number, historicalPct: number | null): number {
  if (historicalPct != null) return Math.min(original, historicalPct);
  return Math.round(original * 0.85);
}
