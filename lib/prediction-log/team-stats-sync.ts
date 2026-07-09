import {
  applyGoalsToActuals,
  applyHalfTimeGoalsToActualsFromStats,
} from "./goal-result-sync";
import { scoreMatch } from "./scoring";
import type { LogMarketKey, LogMatch, TeamSideStats } from "./types";

const SUM_SYNC: Array<{
  field: keyof TeamSideStats;
  market: LogMarketKey;
}> = [
  { field: "totalShots", market: "shots_ou" },
  { field: "shotsOnTarget", market: "sot_ou" },
  { field: "corners", market: "corners_ou" },
  { field: "throwIns", market: "throw_ins_ou" },
  { field: "offsides", market: "offsides_ou" },
];

function sumSideStat(
  home: TeamSideStats | undefined,
  away: TeamSideStats | undefined,
  field: keyof TeamSideStats
): number | null {
  const h = home?.[field];
  const a = away?.[field];
  if (h == null || a == null || !Number.isFinite(h) || !Number.isFinite(a)) {
    return null;
  }
  return h + a;
}

function bothGoalsSet(home?: number, away?: number): boolean {
  return (
    home != null &&
    away != null &&
    Number.isFinite(home) &&
    Number.isFinite(away)
  );
}

function bothHalfGoalsSet(home?: number, away?: number): boolean {
  return home != null && away != null && Number.isFinite(home) && Number.isFinite(away);
}

export function applyTeamStatsSync(match: LogMatch): LogMatch {
  const ts = match.teamStats;
  if (!ts) return scoreMatch(match);

  let actualResults = { ...match.actualResults };

  if (bothGoalsSet(ts.home?.goals, ts.away?.goals)) {
    actualResults = applyGoalsToActuals(match, ts.home!.goals!, ts.away!.goals!, {
      overwrite: true,
    });
  }

  if (bothHalfGoalsSet(ts.home?.firstHalfGoals, ts.away?.firstHalfGoals)) {
    actualResults = {
      ...actualResults,
      ...applyHalfTimeGoalsToActualsFromStats({ ...match, actualResults }),
    };
    if (!ts.firstHalfResult) {
      const hth = ts.home!.firstHalfGoals!;
      const hta = ts.away!.firstHalfGoals!;
      ts.firstHalfResult =
        hth > hta ? "home" : hta > hth ? "away" : "draw";
    }
  } else if (match.predictions.ht_1x2 && ts.firstHalfResult) {
    actualResults.ht_1x2 = { actual: ts.firstHalfResult };
  }

  for (const { field, market } of SUM_SYNC) {
    if (!match.predictions[market]) continue;
    const total = sumSideStat(ts.home, ts.away, field);
    if (total != null) {
      actualResults[market] = { actual: total };
    }
  }

  return scoreMatch({ ...match, actualResults, teamStats: ts });
}
