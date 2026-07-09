import type { CorrectScoreCalibration, CorrectScoreSnapshot, LogMatch, PredictionBatch } from "./types";
import { rankActualScore } from "./correct-score";

const ROLLING_WINDOW = 50;

function parseGoals(match: LogMatch): { home: number; away: number } | null {
  const home = match.teamStats?.home?.goals;
  const away = match.teamStats?.away?.goals;
  if (home != null && away != null && Number.isFinite(home) && Number.isFinite(away)) {
    return { home, away };
  }
  const h = match.actualResults.home_goals_ou?.actual;
  const a = match.actualResults.away_goals_ou?.actual;
  const homeN = typeof h === "number" ? h : h != null ? parseFloat(String(h)) : NaN;
  const awayN = typeof a === "number" ? a : a != null ? parseFloat(String(a)) : NaN;
  if (Number.isFinite(homeN) && Number.isFinite(awayN)) {
    return { home: homeN, away: awayN };
  }
  return null;
}

export function recordCorrectScoreCalibration(
  match: LogMatch,
  snapshot: CorrectScoreSnapshot
): CorrectScoreCalibration | null {
  const goals = parseGoals(match);
  if (!goals) return null;
  return {
    rank: rankActualScore(snapshot, goals.home, goals.away),
    actualHome: goals.home,
    actualAway: goals.away,
  };
}

export interface CorrectScoreStatsResult {
  overall: { top1Hits: number; top3Hits: number; top6Hits: number; sample: number };
  byLeague: Record<string, { top3Hits: number; sample: number }>;
  rollingTop3Rate: number | null;
}

export function recomputeCorrectScoreStats(batches: PredictionBatch[]): CorrectScoreStatsResult {
  const overall = { top1Hits: 0, top3Hits: 0, top6Hits: 0, sample: 0 };
  const byLeague: Record<string, { top3Hits: number; sample: number }> = {};
  const rolling: Array<{ hit: boolean; league: string }> = [];

  for (const batch of batches) {
    for (const match of batch.matches) {
      const cal = match.correctScoreCalibration;
      if (!cal) continue;
      overall.sample++;
      if (cal.rank === "top1") overall.top1Hits++;
      if (cal.rank === "top1" || cal.rank === "top3") overall.top3Hits++;
      if (cal.rank === "top1" || cal.rank === "top3" || cal.rank === "top6") overall.top6Hits++;

      const league = batch.league;
      if (!byLeague[league]) byLeague[league] = { top3Hits: 0, sample: 0 };
      byLeague[league]!.sample++;
      if (cal.rank === "top1" || cal.rank === "top3") byLeague[league]!.top3Hits++;

      rolling.push({
        hit: cal.rank === "top1" || cal.rank === "top3",
        league,
      });
    }
  }

  const recent = rolling.slice(-ROLLING_WINDOW);
  const rollingTop3Rate =
    recent.length > 0
      ? Math.round((recent.filter((r) => r.hit).length / recent.length) * 1000) / 10
      : null;

  return { overall, byLeague, rollingTop3Rate };
}

export function applyCorrectScoreCalibrationToMatch(match: LogMatch): LogMatch {
  if (!match.correctScoreSnapshot) return match;
  const cal = recordCorrectScoreCalibration(match, match.correctScoreSnapshot);
  if (!cal) return match;
  return { ...match, correctScoreCalibration: cal };
}

export function applyCorrectScoreCalibrationToBatches(batches: PredictionBatch[]): PredictionBatch[] {
  return batches.map((batch) => ({
    ...batch,
    matches: batch.matches.map((m) => {
      if (m.correctScoreCalibration) return m;
      return applyCorrectScoreCalibrationToMatch(m);
    }),
  }));
}
