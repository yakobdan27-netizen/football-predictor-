/**
 * Helpers for Path A: add upcoming fixtures into a Prediction Log draft batch.
 */
import type { CombinedOddsSettings, LogMatch } from "./types";
import type { UpcomingFixtureRow } from "@/lib/football-api/fetch-upcoming-league";

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
