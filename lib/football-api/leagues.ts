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

/**
 * API-Football season parameter = starting year of the European season.
 * 2025/26 → 2025. Aug–Dec uses calendar year; Jan–Jul uses calendar year − 1.
 */
export function apiSeasonFromDate(isoDate: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim());
  if (m) {
    const year = parseInt(m[1]!, 10);
    const month = parseInt(m[2]!, 10); // 1–12
    if (Number.isFinite(year) && Number.isFinite(month)) {
      return month >= 8 ? year : year - 1;
    }
  }
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) {
    const year = parseInt(isoDate.slice(0, 4), 10);
    return Number.isFinite(year) ? year : new Date().getFullYear();
  }
  // getMonth(): 0=Jan … 7=Aug
  return d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
}

export function apiDateOnly(isoDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/** Cache key segment for fixtures: league id or "all". */
export function fixturesCacheKey(leagueId: number | null, season: number, date: string): string {
  const leaguePart = leagueId != null ? String(leagueId) : "all";
  return `${leaguePart}:${season}:${date}`;
}
