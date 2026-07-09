import type { MatchRow } from "@/lib/predictor/types";
import { standardizeTeamName } from "./team-names";

export interface CleanReport {
  droppedIncomplete: number;
  droppedInvalid: number;
  duplicatesRemoved: number;
  teamNamesStandardized: number;
  flagged: string[];
}

export interface CleanResult {
  rows: MatchRow[];
  report: CleanReport;
}

function parseDateKey(d?: string): number {
  if (!d) return 0;
  const parts = d.split(/[/-]/);
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    let year = parseInt(parts[2], 10);
    if (year < 100) year += year > 50 ? 1900 : 2000;
    return new Date(year, month, day).getTime();
  }
  const t = Date.parse(d);
  return isNaN(t) ? 0 : t;
}

function isInRange(n: number, min: number, max: number): boolean {
  return n >= min && n <= max && Number.isInteger(n);
}

function validateRanges(row: MatchRow): string | null {
  if (!isInRange(row.FTHG, 0, 9) || !isInRange(row.FTAG, 0, 9)) {
    return "goals out of range (0–9)";
  }
  if (row.HTHG != null && (!isInRange(row.HTHG, 0, 9) || row.HTHG > row.FTHG)) {
    return "HT home goals invalid";
  }
  if (row.HTAG != null && (!isInRange(row.HTAG, 0, 9) || row.HTAG > row.FTAG)) {
    return "HT away goals invalid";
  }
  if (row.HS != null && !isInRange(row.HS, 0, 35)) return "home shots out of range";
  if (row.AS != null && !isInRange(row.AS, 0, 35)) return "away shots out of range";
  if (row.HST != null && !isInRange(row.HST, 0, 20)) return "home SOT out of range";
  if (row.AST != null && !isInRange(row.AST, 0, 20)) return "away SOT out of range";
  if (row.HO != null && !isInRange(row.HO, 0, 10)) return "home offsides out of range";
  if (row.AO != null && !isInRange(row.AO, 0, 10)) return "away offsides out of range";
  if (row.HC != null && !isInRange(row.HC, 0, 20)) return "home corners out of range";
  if (row.AC != null && !isInRange(row.AC, 0, 20)) return "away corners out of range";
  if (row.HTI != null && !isInRange(row.HTI, 0, 50)) return "home throw-ins out of range";
  if (row.ATI != null && !isInRange(row.ATI, 0, 50)) return "away throw-ins out of range";
  return null;
}

function rowKey(row: MatchRow): string {
  return `${row.Date ?? ""}|${row.HomeTeam}|${row.AwayTeam}`;
}

export function cleanMatchRows(rows: MatchRow[]): CleanResult {
  const report: CleanReport = {
    droppedIncomplete: 0,
    droppedInvalid: 0,
    duplicatesRemoved: 0,
    teamNamesStandardized: 0,
    flagged: [],
  };

  const cleaned: MatchRow[] = [];

  for (const raw of rows) {
    if (
      !raw.HomeTeam?.trim() ||
      !raw.AwayTeam?.trim() ||
      raw.FTHG == null ||
      raw.FTAG == null ||
      isNaN(raw.FTHG) ||
      isNaN(raw.FTAG)
    ) {
      report.droppedIncomplete++;
      continue;
    }

    const home = standardizeTeamName(raw.HomeTeam);
    const away = standardizeTeamName(raw.AwayTeam);
    if (home !== raw.HomeTeam.trim() || away !== raw.AwayTeam.trim()) {
      report.teamNamesStandardized++;
    }

    const row: MatchRow = { ...raw, HomeTeam: home, AwayTeam: away };

    const invalid = validateRanges(row);
    if (invalid) {
      report.droppedInvalid++;
      report.flagged.push(`${home} vs ${away}: ${invalid}`);
      continue;
    }

    cleaned.push(row);
  }

  cleaned.sort((a, b) => parseDateKey(a.Date) - parseDateKey(b.Date));

  const seen = new Map<string, MatchRow>();
  for (const row of cleaned) {
    seen.set(rowKey(row), row);
  }

  const deduped = [...seen.values()];
  report.duplicatesRemoved = cleaned.length - deduped.length;

  deduped.sort((a, b) => parseDateKey(a.Date) - parseDateKey(b.Date));

  return { rows: deduped, report };
}
