import type { LogMatch } from "./types";

/** YYYY-MM-DD today (UTC). */
export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Derive batch.date from the earliest per-match date (fixture kickoff day).
 * Falls back to today when no match dates are set.
 */
export function deriveBatchDateFromMatches(
  matches: Pick<LogMatch, "matchDate">[],
  fallback?: string
): string {
  const dates = matches
    .map((m) => m.matchDate?.trim())
    .filter((d): d is string => Boolean(d && /^\d{4}-\d{2}-\d{2}/.test(d)))
    .map((d) => d.slice(0, 10))
    .sort();
  if (dates.length) return dates[0]!;
  if (fallback && /^\d{4}-\d{2}-\d{2}/.test(fallback)) return fallback.slice(0, 10);
  return todayIsoDate();
}
