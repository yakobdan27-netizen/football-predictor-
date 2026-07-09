import type { PredictionBatch } from "./types";

export interface LeagueBaseline {
  league: string;
  league_avg_home_goals: number;
  league_avg_away_goals: number;
  sampleSize: number;
}

export type LeagueBaselinesStore = Record<string, LeagueBaseline>;

function extractGoalActual(
  match: PredictionBatch["matches"][number],
  key: "home_goals_ou" | "away_goals_ou"
): number | null {
  const raw = match.actualResults[key]?.actual;
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

export function computeLeagueBaselines(batches: PredictionBatch[]): LeagueBaselinesStore {
  const byLeague = new Map<string, { homeGoals: number[]; awayGoals: number[] }>();

  for (const batch of batches) {
    const bucket = byLeague.get(batch.league) ?? { homeGoals: [], awayGoals: [] };
    for (const match of batch.matches) {
      const hg = extractGoalActual(match, "home_goals_ou");
      const ag = extractGoalActual(match, "away_goals_ou");
      if (hg != null) bucket.homeGoals.push(hg);
      if (ag != null) bucket.awayGoals.push(ag);
    }
    byLeague.set(batch.league, bucket);
  }

  const store: LeagueBaselinesStore = {};
  for (const [league, data] of byLeague) {
    const avg = (arr: number[]) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    store[league] = {
      league,
      league_avg_home_goals: Math.round(avg(data.homeGoals) * 100) / 100,
      league_avg_away_goals: Math.round(avg(data.awayGoals) * 100) / 100,
      sampleSize: data.homeGoals.length + data.awayGoals.length,
    };
  }
  return store;
}

export function getLeagueBaseline(
  store: LeagueBaselinesStore | null | undefined,
  league: string,
  defaults: { home: number; away: number }
): { league_avg_home_goals: number; league_avg_away_goals: number } {
  const entry = store?.[league];
  if (!entry || entry.sampleSize < 3) {
    return {
      league_avg_home_goals: defaults.home,
      league_avg_away_goals: defaults.away,
    };
  }
  return {
    league_avg_home_goals: entry.league_avg_home_goals || defaults.home,
    league_avg_away_goals: entry.league_avg_away_goals || defaults.away,
  };
}
