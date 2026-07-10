import { cloneMatchTeamStats } from "./match-learning";
import { gradeMatchFromFacts } from "./grade-from-facts";
import type { LogMatch } from "./types";

/** Set home possession and auto-complement away to 100 − home (clamped 0–100). */
export function setHomePossession(
  match: LogMatch,
  homePct: number | ""
): LogMatch {
  const teamStats = cloneMatchTeamStats(match);
  if (homePct === "" || !Number.isFinite(homePct)) {
    delete teamStats.home.possession;
    delete teamStats.away.possession;
  } else {
    const h = Math.max(0, Math.min(100, Math.round(homePct)));
    teamStats.home.possession = h;
    teamStats.away.possession = 100 - h;
  }
  return applyTeamStatsSync({ ...match, teamStats });
}

/**
 * Normalize possession / HT result flags, then grade all markets from facts.
 * Actuals are derived inside gradeMatchFromFacts (ungated).
 */
export function applyTeamStatsSync(match: LogMatch): LogMatch {
  const ts = match.teamStats;
  if (!ts) return gradeMatchFromFacts(match);

  if (ts.home?.possession != null && Number.isFinite(ts.home.possession)) {
    const h = Math.max(0, Math.min(100, ts.home.possession));
    ts.home.possession = h;
    ts.away = { ...ts.away, possession: 100 - h };
  }

  const hth = ts.home?.firstHalfGoals;
  const ath = ts.away?.firstHalfGoals;
  if (
    hth != null &&
    ath != null &&
    Number.isFinite(hth) &&
    Number.isFinite(ath) &&
    !ts.firstHalfResult
  ) {
    ts.firstHalfResult = hth > ath ? "home" : ath > hth ? "away" : "draw";
  }

  return gradeMatchFromFacts({ ...match, teamStats: ts });
}
