import type { MatchRow } from "./types";
import type { B365Odds } from "./odds";

function parseDate(d?: string): number {
  if (!d) return 0;
  const parts = d.split(/[/-]/);
  if (parts.length !== 3) return 0;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  let year = parseInt(parts[2], 10);
  if (year < 100) year += year > 50 ? 1900 : 2000;
  return new Date(year, month, day).getTime();
}

export function b365FromRow(row: MatchRow): B365Odds | null {
  if (
    row.B365H == null ||
    row.B365D == null ||
    row.B365A == null ||
    row.B365H <= 1 ||
    row.B365D <= 1 ||
    row.B365A <= 1
  ) {
    return null;
  }
  return {
    home: row.B365H,
    draw: row.B365D,
    away: row.B365A,
    over25: row.B365Over25,
    under25: row.B365Under25,
  };
}

export function findOddsForFixture(
  home: string,
  away: string,
  rows: MatchRow[]
): B365Odds | null {
  let best: MatchRow | null = null;
  let bestDate = -1;
  for (const row of rows) {
    if (row.HomeTeam !== home || row.AwayTeam !== away) continue;
    const odds = b365FromRow(row);
    if (!odds) continue;
    const t = parseDate(row.Date);
    if (t >= bestDate) {
      bestDate = t;
      best = row;
    }
  }
  return best ? b365FromRow(best) : null;
}
