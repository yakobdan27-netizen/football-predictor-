import type {
  LogMatch,
  MatchTeamStats,
  TeamSideStats,
} from "@/lib/prediction-log/types";
import type { LivescoreScrapeResult, LivescoreSideStats } from "./types";

function setIfEmpty(
  side: TeamSideStats,
  field: keyof TeamSideStats,
  value: number | undefined
): void {
  if (value == null || !Number.isFinite(value)) return;
  if (side[field] != null) return;
  side[field] = value;
}

function mergeSide(target: TeamSideStats, src: LivescoreSideStats): void {
  setIfEmpty(target, "goals", src.goals);
  setIfEmpty(target, "firstHalfGoals", src.firstHalfGoals);
  setIfEmpty(target, "possession", src.possession);
  setIfEmpty(target, "totalShots", src.totalShots);
  setIfEmpty(target, "shotsOnTarget", src.shotsOnTarget);
  setIfEmpty(target, "corners", src.corners);
  setIfEmpty(target, "fouls", src.fouls);
  setIfEmpty(target, "yellowCards", src.yellowCards);
  setIfEmpty(target, "redCards", src.redCards);
  setIfEmpty(target, "throwIns", src.throwIns);
  setIfEmpty(target, "offsides", src.offsides);
}

/**
 * Map a Livescore scrape into empty-field updates on a LogMatch (no grading).
 */
export function mapScrapeToMatchUpdates(
  scrape: LivescoreScrapeResult,
  match: LogMatch,
  options?: { resultSource?: LogMatch["resultSource"] }
): Partial<LogMatch> {
  const teamStats: MatchTeamStats = match.teamStats
    ? {
        ...match.teamStats,
        home: { ...match.teamStats.home },
        away: { ...match.teamStats.away },
        goalTiming: match.teamStats.goalTiming
          ? { ...match.teamStats.goalTiming }
          : undefined,
      }
    : { home: {}, away: {} };

  mergeSide(teamStats.home, scrape.home);
  mergeSide(teamStats.away, scrape.away);

  if (
    scrape.goalInFirst10 != null &&
    teamStats.goalTiming?.goalInFirst10 == null
  ) {
    teamStats.goalTiming = {
      ...teamStats.goalTiming,
      goalInFirst10: scrape.goalInFirst10,
    };
  }

  if (scrape.firstGoalSide && teamStats.firstGoalSide == null) {
    teamStats.firstGoalSide = scrape.firstGoalSide;
  }

  if (scrape.lineups && !teamStats.lineups) {
    teamStats.lineups = scrape.lineups;
  }

  const hth = teamStats.home.firstHalfGoals;
  const ath = teamStats.away.firstHalfGoals;
  if (
    hth != null &&
    ath != null &&
    Number.isFinite(hth) &&
    Number.isFinite(ath) &&
    !teamStats.firstHalfResult
  ) {
    teamStats.firstHalfResult = hth > ath ? "home" : ath > hth ? "away" : "draw";
  }

  return {
    teamStats,
    resultSource: options?.resultSource ?? "livescore",
    livescoreEventId: scrape.eventId,
    livescoreUrl: scrape.url,
  };
}

/** Pure helper for tests: scrape JSON → MatchTeamStats shape. */
export function scrapeToTeamStats(scrape: LivescoreScrapeResult): MatchTeamStats {
  const stub: LogMatch = {
    id: "test",
    homeTeam: scrape.homeTeam,
    awayTeam: scrape.awayTeam,
    predictions: {},
    actualResults: {},
    scored: {},
  };
  return mapScrapeToMatchUpdates(scrape, stub).teamStats!;
}
