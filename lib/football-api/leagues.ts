import type { LeagueOption } from "@/lib/prediction-log/markets-config";

export const LEAGUE_API_IDS: Record<LeagueOption, number> = {
  "Premier League": 39,
  "La Liga": 140,
  "Serie A": 135,
  Bundesliga: 78,
  "Ligue 1": 61,
  "UEFA Champions League": 2,
  "UEFA Europa League": 3,
  "UEFA Europa Conference League": 848,
};

export function apiLeagueId(league: string): number | null {
  return LEAGUE_API_IDS[league as LeagueOption] ?? null;
}

/** European season year the API expects (season ends in this calendar year). */
export function apiSeasonFromDate(isoDate: string): number {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) {
    const year = parseInt(isoDate.slice(0, 4), 10);
    return Number.isFinite(year) ? year : new Date().getFullYear();
  }
  return d.getMonth() >= 7 ? d.getFullYear() + 1 : d.getFullYear();
}

export function apiDateOnly(isoDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate.slice(0, 10);
  return d.toISOString().slice(0, 10);
}
