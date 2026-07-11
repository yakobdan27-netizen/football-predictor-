import { fixturePairKey } from "@/lib/football-api/team-resolve";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";
import { toLivescoreDateKey } from "./resolve-match";

export const BULK_SEASON = "2025/2026" as const;
export const SEASON_START_YMD = "20250801";
export const SEASON_END_YMD = "20260731";
export const BULK_LAST_N = 5;
export const BULK_MAX_LOOKBACK_DAYS = 45;

export interface BulkDiscoveredMatch {
  eventId: string;
  /** YYYY-MM-DD */
  date: string;
  homeTeam: string;
  awayTeam: string;
  competition?: string;
  status?: string;
  statsUrl?: string;
}

export function ymdToIso(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

export function isoToYmd(iso: string): string {
  return toLivescoreDateKey(iso);
}

/** True if YYYYMMDD falls inside season 2025/2026 window. */
export function isInSeasonWindow(ymd: string): boolean {
  const key = ymd.replace(/[^0-9]/g, "").slice(0, 8);
  if (key.length !== 8) return false;
  return key >= SEASON_START_YMD && key <= SEASON_END_YMD;
}

export function isFinishedStatus(status: string | undefined): boolean {
  const s = (status ?? "").toUpperCase();
  return s === "FT" || s === "AET" || s === "AP" || s === "AOT";
}

/** Build lookback date keys (YYYYMMDD) from `from` going backward, capped. */
export function lookbackDateKeys(from: Date, maxDays: number = BULK_MAX_LOOKBACK_DAYS): string[] {
  const keys: string[] = [];
  for (let i = 0; i < maxDays; i++) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - i);
    const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
    if (!isInSeasonWindow(ymd) && ymd < SEASON_START_YMD) break;
    if (isInSeasonWindow(ymd)) keys.push(ymd);
  }
  return keys;
}

export function matchDedupeKey(date: string, home: string, away: string): string {
  const ymd = toLivescoreDateKey(date);
  return `${ymd}|${fixturePairKey(home, away)}`;
}

export function buildExistingDedupeIndex(batches: PredictionBatch[]): {
  byEventId: Set<string>;
  byPairDate: Set<string>;
} {
  const byEventId = new Set<string>();
  const byPairDate = new Set<string>();
  for (const batch of batches) {
    for (const m of batch.matches) {
      if (m.livescoreEventId) byEventId.add(m.livescoreEventId);
      try {
        byPairDate.add(matchDedupeKey(batch.date, m.homeTeam, m.awayTeam));
      } catch {
        /* skip bad dates */
      }
      // Also key by match-level date if teamStats imply a different day via livescore
      if (m.livescoreEventId) {
        /* already indexed */
      }
    }
  }
  return { byEventId, byPairDate };
}

export function isDuplicateMatch(
  candidate: BulkDiscoveredMatch,
  index: { byEventId: Set<string>; byPairDate: Set<string> }
): boolean {
  if (index.byEventId.has(candidate.eventId)) return true;
  const key = matchDedupeKey(candidate.date, candidate.homeTeam, candidate.awayTeam);
  return index.byPairDate.has(key);
}

/** Keep newest first, max N unique event ids. */
export function selectTopFinished(
  matches: BulkDiscoveredMatch[],
  n: number = BULK_LAST_N
): BulkDiscoveredMatch[] {
  const sorted = [...matches].sort((a, b) => {
    const da = toLivescoreDateKey(a.date);
    const db = toLivescoreDateKey(b.date);
    if (da !== db) return db.localeCompare(da);
    return String(b.eventId).localeCompare(String(a.eventId));
  });
  const out: BulkDiscoveredMatch[] = [];
  const seen = new Set<string>();
  for (const m of sorted) {
    if (seen.has(m.eventId)) continue;
    seen.add(m.eventId);
    out.push(m);
    if (out.length >= n) break;
  }
  return out;
}

export function emptyBulkMatch(id: string, row: BulkDiscoveredMatch): LogMatch {
  return {
    id,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    predictions: {},
    actualResults: {},
    scored: {},
    livescoreEventId: row.eventId,
    livescoreUrl: row.statsUrl,
    resultSource: "livescore-bulk",
  };
}
