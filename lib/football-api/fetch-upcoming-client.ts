/**
 * Browser client for GET /api/fixtures/upcoming (shared by Match Centre + Upcoming Predictions).
 */
import {
  NEXT_MATCHES_LEAGUES,
  type NextMatchesLeague,
  type UpcomingFixtureRow,
} from "./fetch-upcoming-league";

export type UpcomingLeagueFetchResult = {
  league: NextMatchesLeague;
  season: number | null;
  fixtures: UpcomingFixtureRow[];
  error: string | null;
  fromCache?: boolean;
};

export const UPCOMING_API_UNAVAILABLE_COPY =
  "API unavailable — try again or enter batches manually.";

export async function fetchUpcomingLeagueClient(
  league: NextMatchesLeague,
  refresh = false,
  next = 10
): Promise<UpcomingLeagueFetchResult> {
  const q = new URLSearchParams({
    league,
    next: String(next),
    ...(refresh ? { refresh: "1" } : {}),
  });
  const res = await fetch(`/api/fixtures/upcoming?${q}`);
  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    warning?: string;
    season?: number;
    fixtures?: UpcomingFixtureRow[];
    fromCache?: boolean;
  };
  if (!res.ok) {
    return {
      league,
      season: null,
      fixtures: data.fixtures ?? [],
      error: data.warning ?? UPCOMING_API_UNAVAILABLE_COPY,
      fromCache: data.fromCache,
    };
  }
  return {
    league,
    season: data.season ?? null,
    fixtures: data.fixtures ?? [],
    error: data.warning ? UPCOMING_API_UNAVAILABLE_COPY : null,
    fromCache: data.fromCache,
  };
}

export async function fetchAllUpcomingLeaguesClient(
  refresh = false,
  next = 10
): Promise<{
  results: UpcomingLeagueFetchResult[];
  fixtures: UpcomingFixtureRow[];
  loading: false;
}> {
  const results = await Promise.all(
    NEXT_MATCHES_LEAGUES.map((league) =>
      fetchUpcomingLeagueClient(league, refresh, next)
    )
  );
  const fixtures: UpcomingFixtureRow[] = [];
  for (const r of results) fixtures.push(...r.fixtures);
  return { results, fixtures, loading: false };
}

export { NEXT_MATCHES_LEAGUES };
