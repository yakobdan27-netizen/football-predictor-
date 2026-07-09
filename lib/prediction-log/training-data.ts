import type { AnalysisHistory, LogMatch, PredictionBatch } from "./types";
import type { ClubRecord, MatchupCache } from "./club-record-types";
import type { LeagueBaselinesStore } from "./league-baselines";
import type { TeamsQualityStore } from "./teams-quality-types";
import { TIER_RANK } from "./teams-quality";
import { lookupTeam } from "./teams-quality";

export type OutcomeLabel = "home" | "draw" | "away";

export interface TrainingFeatureRow {
  features: number[];
  label: OutcomeLabel;
  matchId: string;
  batchId: string;
}

export const FEATURE_NAMES = [
  "home_attack_home",
  "home_attack_away",
  "home_defense_home",
  "home_defense_away",
  "away_attack_home",
  "away_attack_away",
  "away_defense_home",
  "away_defense_away",
  "home_goals_rolling",
  "away_goals_rolling",
  "home_form",
  "away_form",
  "tier_gap",
  "h2h_home_rate",
  "home_xg",
  "away_xg",
  "user_accuracy",
] as const;

function outcomeFromActual(actual: string): OutcomeLabel | null {
  const a = actual.toLowerCase();
  if (a === "home") return "home";
  if (a === "draw") return "draw";
  if (a === "away") return "away";
  return null;
}

function h2hHomeWinRate(
  homeId: string | undefined,
  awayId: string | undefined,
  matchupCaches: Record<string, MatchupCache>
): number {
  if (!homeId || !awayId) return 0.5;
  const key = [homeId, awayId].sort().join("_");
  const cache = Object.values(matchupCaches).find(
    (c) =>
      (c.clubIdA === homeId && c.clubIdB === awayId) ||
      (c.clubIdA === awayId && c.clubIdB === homeId)
  );
  if (!cache || cache.meetings === 0) return 0.5;
  const homeIsA = cache.clubIdA === homeId;
  const homeWins = homeIsA ? cache.homeWinsA : cache.awayWinsA;
  return homeWins / cache.meetings;
}

export function buildTrainingRows(
  batches: PredictionBatch[],
  clubRecords: Record<string, ClubRecord>,
  analysis: AnalysisHistory | null,
  teamsQuality: TeamsQualityStore | null,
  _leagueBaselines: LeagueBaselinesStore | null,
  matchupCaches: Record<string, MatchupCache> = {}
): TrainingFeatureRow[] {
  const rows: TrainingFeatureRow[] = [];
  const userAcc = analysis?.marketAccuracy["1x2"]?.pct ?? 50;

  for (const batch of batches) {
    for (const match of batch.matches) {
      const actual = match.actualResults["1x2"]?.actual;
      if (typeof actual !== "string") continue;
      const label = outcomeFromActual(actual);
      if (!label) continue;

      const homeRec = match.homeClubId ? clubRecords[match.homeClubId] : null;
      const awayRec = match.awayClubId ? clubRecords[match.awayClubId] : null;
      const homeMeta = homeRec?.statMetadata;
      const awayMeta = awayRec?.statMetadata;

      const homeTier = lookupTeam(teamsQuality, match.homeTeam)?.tier;
      const awayTier = lookupTeam(teamsQuality, match.awayTeam)?.tier;
      const tierGap =
        homeTier && awayTier ? TIER_RANK[homeTier] - TIER_RANK[awayTier] : 0;

      const features = [
        homeMeta?.attack_strength_home ?? 1,
        homeMeta?.attack_strength_away ?? 1,
        homeMeta?.defense_strength_home ?? 1,
        homeMeta?.defense_strength_away ?? 1,
        awayMeta?.attack_strength_home ?? 1,
        awayMeta?.attack_strength_away ?? 1,
        awayMeta?.defense_strength_home ?? 1,
        awayMeta?.defense_strength_away ?? 1,
        homeMeta?.goals_for_rolling ?? 0,
        awayMeta?.goals_for_rolling ?? 0,
        homeMeta?.form_points ?? 0,
        awayMeta?.form_points ?? 0,
        tierGap,
        h2hHomeWinRate(match.homeClubId, match.awayClubId, matchupCaches),
        homeMeta?.xg_for ?? 0,
        awayMeta?.xg_for ?? 0,
        (userAcc ?? 50) / 100,
      ];

      rows.push({ features, label, matchId: match.id, batchId: batch.id });
    }
  }
  return rows;
}

export function buildInferenceFeatures(
  match: LogMatch,
  homeRecord: ClubRecord | null,
  awayRecord: ClubRecord | null,
  analysis: AnalysisHistory | null,
  teamsQuality: TeamsQualityStore | null,
  matchupCaches: Record<string, MatchupCache> = {}
): number[] {
  const homeMeta = homeRecord?.statMetadata;
  const awayMeta = awayRecord?.statMetadata;
  const homeTier = lookupTeam(teamsQuality, match.homeTeam)?.tier;
  const awayTier = lookupTeam(teamsQuality, match.awayTeam)?.tier;
  const tierGap = homeTier && awayTier ? TIER_RANK[homeTier] - TIER_RANK[awayTier] : 0;
  const userAcc = analysis?.marketAccuracy["1x2"]?.pct ?? 50;

  return [
    homeMeta?.attack_strength_home ?? 1,
    homeMeta?.attack_strength_away ?? 1,
    homeMeta?.defense_strength_home ?? 1,
    homeMeta?.defense_strength_away ?? 1,
    awayMeta?.attack_strength_home ?? 1,
    awayMeta?.attack_strength_away ?? 1,
    awayMeta?.defense_strength_home ?? 1,
    awayMeta?.defense_strength_away ?? 1,
    homeMeta?.goals_for_rolling ?? 0,
    awayMeta?.goals_for_rolling ?? 0,
    homeMeta?.form_points ?? 0,
    awayMeta?.form_points ?? 0,
    tierGap,
    h2hHomeWinRate(match.homeClubId, match.awayClubId, matchupCaches),
    homeMeta?.xg_for ?? 0,
    awayMeta?.xg_for ?? 0,
    (userAcc ?? 50) / 100,
  ];
}
