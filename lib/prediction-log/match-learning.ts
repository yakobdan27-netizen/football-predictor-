import { matchHasRichSettlement } from "./match-settlement";
import type { LogMatch, MatchTeamStats } from "./types";
export const ABNORMAL_MATCH_WEIGHT = 0.25;

export function matchLearningWeight(
  teamStats?: MatchTeamStats | null
): number {
  return teamStats?.abnormalMatch ? ABNORMAL_MATCH_WEIGHT : 1;
}

export function cloneMatchTeamStats(match: LogMatch): MatchTeamStats {
  const ts = match.teamStats;
  return {
    home: { ...ts?.home },
    away: { ...ts?.away },
    firstHalfResult: ts?.firstHalfResult,
    goalTiming: ts?.goalTiming
      ? {
          ...ts.goalTiming,
          timingBuckets: ts.goalTiming.timingBuckets
            ? { ...ts.goalTiming.timingBuckets }
            : undefined,
        }
      : undefined,
    penaltyAwarded: ts?.penaltyAwarded,
    firstGoalSide: ts?.firstGoalSide,
    penaltiesAwarded: ts?.penaltiesAwarded
      ? { ...ts.penaltiesAwarded }
      : undefined,
    abnormalMatch: ts?.abnormalMatch,
  };
}

/** Prefer explicit firstGoalSide; else HT leader as proxy (draw → none). */
export function resolveFirstGoalSide(
  match: LogMatch
): "home" | "away" | "none" | null {
  const explicit = match.teamStats?.firstGoalSide;
  if (explicit === "home" || explicit === "away" || explicit === "none") {
    return explicit;
  }
  const hth = match.teamStats?.home?.firstHalfGoals;
  const ath = match.teamStats?.away?.firstHalfGoals;
  if (hth == null || ath == null || !Number.isFinite(hth) || !Number.isFinite(ath)) {
    return null;
  }
  if (hth > ath) return "home";
  if (ath > hth) return "away";
  return "none";
}

export function matchHasPenalties(teamStats?: MatchTeamStats | null): boolean {
  if (!teamStats) return false;
  if (teamStats.penaltyAwarded) return true;
  const p = teamStats.penaltiesAwarded;
  return (p?.home != null && p.home > 0) || (p?.away != null && p.away > 0);
}

const ADVANCED_SIDE_FIELDS: Array<keyof NonNullable<MatchTeamStats["home"]>> = [
  "totalShots",
  "shotsOnTarget",
  "corners",
  "fouls",
  "yellowCards",
  "redCards",
  "possession",
  "offsides",
];

/** grey / amber / partial / green completeness for result entry. */
export function resultCompleteness(
  match: LogMatch
): "empty" | "ft" | "partial" | "rich" {
  const hg = match.teamStats?.home?.goals;
  const ag = match.teamStats?.away?.goals;
  if (hg == null || ag == null || !Number.isFinite(hg) || !Number.isFinite(ag)) {
    return "empty";
  }
  if (matchHasRichSettlement(match)) return "rich";

  const ts = match.teamStats;
  if (!ts) return "ft";
  for (const field of ADVANCED_SIDE_FIELDS) {
    if (ts.home?.[field] != null || ts.away?.[field] != null) return "partial";
  }
  if (ts.home?.firstHalfGoals != null || ts.away?.firstHalfGoals != null) {
    return "partial";
  }
  if (ts.firstGoalSide != null) return "partial";
  if (ts.goalTiming?.goalInFirst10 != null) return "partial";
  if (ts.goalTiming?.timingBuckets) return "partial";
  if (matchHasPenalties(ts)) return "partial";
  if (ts.abnormalMatch) return "partial";
  return "ft";
}
