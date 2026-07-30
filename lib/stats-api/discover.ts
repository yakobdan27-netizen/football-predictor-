import { isStatsApiConfigured, statsApiGet } from "./client";
import { parseStatsApiMatchList } from "./parse";
import type { StatsApiDayMatch } from "./types";
import { STATS_API_PL_COMPETITION_ID } from "./competitions";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysUtc(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Default lookback for PL-month refresh. Kept short intentionally —
 * there is no bulk `/stats` endpoint, so each mapped fixture costs ≥1 request.
 */
export const STATS_API_LOOKBACK_DAYS = 30;

export function statsApiDefaultDateRange(now = new Date()): {
  dateFrom: string;
  dateTo: string;
} {
  const dateTo = now.toISOString().slice(0, 10);
  const dateFrom = addDaysUtc(dateTo, -STATS_API_LOOKBACK_DAYS);
  return { dateFrom, dateTo };
}

async function listMatchesPage(opts: {
  dateFrom: string;
  dateTo: string;
  page: number;
  status: string;
  competitionId?: string;
}): Promise<{ rows: StatsApiDayMatch[]; totalPages: number }> {
  const payload = await statsApiGet<{
    data?: unknown[];
    meta?: { total_pages?: number; total?: number };
  }>("/football/matches", {
    date_from: opts.dateFrom,
    date_to: opts.dateTo,
    per_page: 100,
    page: opts.page,
    status: opts.status,
    competition_id: opts.competitionId,
  });
  return {
    rows: parseStatsApiMatchList(payload),
    totalPages: payload?.meta?.total_pages ?? 1,
  };
}

/**
 * Discover Stats API matches across a date range (paginated).
 * Prefer `competitionIds` — unscoped listing is worldwide and huge.
 * Used to map API-Football fixtures → `mt_…` ids before `/stats`.
 */
export async function discoverStatsApiMatches(opts?: {
  dateFrom?: string;
  dateTo?: string;
  /** Soft cap on API list pages per competition×status (100 matches each). */
  maxPages?: number;
  /** Stats API competition_id values (e.g. `comp_3039`). */
  competitionIds?: string[];
}): Promise<StatsApiDayMatch[]> {
  if (!isStatsApiConfigured()) return [];

  const defaults = statsApiDefaultDateRange();
  const dateFrom = opts?.dateFrom ?? defaults.dateFrom;
  const dateTo = opts?.dateTo ?? defaults.dateTo;
  const maxPages = opts?.maxPages ?? 8;
  const competitionIds =
    opts?.competitionIds?.filter(Boolean) ??
    /* Safer default: PL only rather than every competition worldwide. */
    [STATS_API_PL_COMPETITION_ID];

  try {
    const pages: StatsApiDayMatch[] = [];

    for (const competitionId of competitionIds) {
      for (let page = 1; page <= maxPages; page++) {
        const { rows, totalPages } = await listMatchesPage({
          dateFrom,
          dateTo,
          page,
          status: "finished",
          competitionId,
        });
        pages.push(...rows);
        if (page >= totalPages || rows.length === 0) break;
      }

      // Also pull live/scheduled in-window so today's in-play still maps
      if (dateTo === todayUtc()) {
        for (const status of ["live", "scheduled"] as const) {
          const { rows } = await listMatchesPage({
            dateFrom: dateTo,
            dateTo,
            page: 1,
            status,
            competitionId,
          });
          pages.push(...rows);
        }
      }
    }

    const seen = new Set<string>();
    return pages.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  } catch (e) {
    console.warn(
      "[stats-api] match discover failed:",
      e instanceof Error ? e.message : e
    );
    return [];
  }
}

/**
 * @deprecated Prefer discoverStatsApiMatches with a range.
 * Kept for callers that only need a single calendar day.
 */
export async function discoverStatsApiDayMatches(
  date = todayUtc()
): Promise<StatsApiDayMatch[]> {
  return discoverStatsApiMatches({
    dateFrom: date,
    dateTo: date,
    maxPages: 4,
    competitionIds: [STATS_API_PL_COMPETITION_ID],
  });
}

export { addDaysUtc, todayUtc };
