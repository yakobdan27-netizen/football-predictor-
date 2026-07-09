/** European football season label e.g. "2025/26" from an ISO date. */
export function seasonForDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return seasonForYear(new Date().getFullYear());
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  const startYear = month >= 8 ? year : year - 1;
  return seasonForYear(startYear);
}

export function seasonForYear(startYear: number): string {
  const end = (startYear + 1) % 100;
  return `${startYear}/${String(end).padStart(2, "0")}`;
}

export function leagueProfileKey(leagueId: string, season: string): string {
  return `${leagueId}::${season}`;
}
