/**
 * Helpers for Path A: add upcoming fixtures into a Prediction Log draft batch.
 */
import type { UpcomingFixtureRow } from "@/lib/football-api/fetch-upcoming-league";
import { deriveBatchDateFromMatches } from "./batch-date";
import { defaultCombinedOddsSettings } from "./combo-settings";
import { deriveBatchLeague } from "./match-league";
import type { CombinedOddsSettings, LogMatch, PredictionBatch } from "./types";

export function draftHasApiFixtureId(
  matches: Pick<LogMatch, "apiFixtureId">[],
  apiFixtureId: number
): boolean {
  return matches.some((m) => m.apiFixtureId === apiFixtureId);
}

/** Map an upcoming fixture row into a LogMatch ready for market entry. */
export function logMatchFromUpcomingFixture(
  row: UpcomingFixtureRow,
  opts: {
    id: string;
    settings: CombinedOddsSettings;
  }
): LogMatch {
  return {
    id: opts.id,
    homeTeam: row.home.name,
    awayTeam: row.away.name,
    league: row.league,
    matchDate: row.matchDate,
    apiFixtureId: row.apiFixtureId,
    fixtureStatus: row.status,
    homeApiTeamId: row.home.id ?? undefined,
    awayApiTeamId: row.away.id ?? undefined,
    predictions: {},
    actualResults: {},
    scored: {},
    marketMode: opts.settings.defaultMarketMode,
  };
}

/** Drop blank placeholder rows (no teams) when inserting real fixtures. */
export function appendFixtureMatches(
  existing: LogMatch[],
  incoming: LogMatch[]
): LogMatch[] {
  const kept = existing.filter(
    (m) => m.homeTeam.trim() || m.awayTeam.trim() || m.apiFixtureId != null
  );
  return [...kept, ...incoming];
}

function kickoffMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Dedupe by apiFixtureId, earliest kickoff first. */
export function sortDedupeUpcomingFixtures(
  fixtures: UpcomingFixtureRow[]
): UpcomingFixtureRow[] {
  const sorted = [...fixtures].sort(
    (a, b) => kickoffMs(a.kickoffIso) - kickoffMs(b.kickoffIso)
  );
  const seen = new Set<number>();
  const out: UpcomingFixtureRow[] = [];
  for (const row of sorted) {
    if (seen.has(row.apiFixtureId)) continue;
    seen.add(row.apiFixtureId);
    out.push(row);
  }
  return out;
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Keep fixtures kicking off within the next 7 calendar days (from today). */
export function filterUpcomingNext7Days(
  fixtures: UpcomingFixtureRow[],
  now = new Date()
): UpcomingFixtureRow[] {
  const windowStart = startOfLocalDay(now);
  const windowEnd = windowStart + 7 * 24 * 60 * 60 * 1000;
  return sortDedupeUpcomingFixtures(
    fixtures.filter((row) => {
      const t = kickoffMs(row.kickoffIso);
      return t >= windowStart && t < windowEnd;
    })
  );
}

/**
 * In-memory batch for upcoming API fixtures (not persisted to KV).
 */
export function buildUpcomingPredictionBatch(
  fixtures: UpcomingFixtureRow[],
  opts?: {
    settings?: CombinedOddsSettings;
    batchId?: string;
  }
): PredictionBatch | null {
  const rows = sortDedupeUpcomingFixtures(fixtures);
  if (rows.length === 0) return null;

  const settings = opts?.settings ?? defaultCombinedOddsSettings();
  const batchDate = deriveBatchDateFromMatches(
    rows.map((r) => ({ matchDate: r.matchDate }))
  );
  const batchId = opts?.batchId ?? `UPCOMING-${batchDate}`;

  const matches = rows.map((row, i) =>
    logMatchFromUpcomingFixture(row, {
      id: `${batchId}-m${i + 1}`,
      settings,
    })
  );

  return {
    id: batchId,
    date: batchDate,
    league: deriveBatchLeague(matches),
    batchName: "Upcoming (API)",
    createdAt: new Date().toISOString(),
    batchKind: "manual",
    source: "web",
    matches,
  };
}
