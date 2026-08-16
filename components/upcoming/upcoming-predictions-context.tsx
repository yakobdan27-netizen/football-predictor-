"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchAllUpcomingLeaguesClient,
  NEXT_MATCHES_LEAGUES,
  type UpcomingLeagueFetchResult,
  UPCOMING_API_UNAVAILABLE_COPY,
} from "@/lib/football-api/fetch-upcoming-client";
import type { UpcomingFixtureRow } from "@/lib/football-api/fetch-upcoming-league";
import { buildUpcomingPredictionBatch } from "@/lib/prediction-log/batch-fixture-picker";
import type { PredictionBatch } from "@/lib/prediction-log/types";

export type UpcomingPredictionsContextValue = {
  fixtures: UpcomingFixtureRow[];
  batch: PredictionBatch | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  fixtureCountByLeague: Record<string, number>;
  leagueResults: UpcomingLeagueFetchResult[];
  refresh: () => Promise<void>;
};

const UpcomingPredictionsContext =
  createContext<UpcomingPredictionsContextValue | null>(null);

export function useUpcomingPredictions(): UpcomingPredictionsContextValue {
  const ctx = useContext(UpcomingPredictionsContext);
  if (!ctx) {
    throw new Error("useUpcomingPredictions must be used within UpcomingPredictionsProvider");
  }
  return ctx;
}

export function UpcomingPredictionsProvider({ children }: { children: ReactNode }) {
  const [fixtures, setFixtures] = useState<UpcomingFixtureRow[]>([]);
  const [leagueResults, setLeagueResults] = useState<UpcomingLeagueFetchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const { results, fixtures: merged } = await fetchAllUpcomingLeaguesClient(refresh);
      setLeagueResults(results);
      setFixtures(merged);
      const anyError = results.find((r) => r.error && r.fixtures.length === 0);
      const partialWarning = results.find((r) => r.error && r.fixtures.length > 0);
      if (anyError && merged.length === 0) {
        setError(anyError.error ?? UPCOMING_API_UNAVAILABLE_COPY);
      } else if (partialWarning?.error) {
        setError(partialWarning.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : UPCOMING_API_UNAVAILABLE_COPY);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const refresh = useCallback(async () => {
    await load(true);
  }, [load]);

  const batch = useMemo(
    () => buildUpcomingPredictionBatch(fixtures),
    [fixtures]
  );

  const fixtureCountByLeague = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of NEXT_MATCHES_LEAGUES) counts[l] = 0;
    for (const f of fixtures) {
      counts[f.league] = (counts[f.league] ?? 0) + 1;
    }
    return counts;
  }, [fixtures]);

  const value = useMemo(
    (): UpcomingPredictionsContextValue => ({
      fixtures,
      batch,
      loading,
      refreshing,
      error,
      fixtureCountByLeague,
      leagueResults,
      refresh,
    }),
    [
      fixtures,
      batch,
      loading,
      refreshing,
      error,
      fixtureCountByLeague,
      leagueResults,
      refresh,
    ]
  );

  return (
    <UpcomingPredictionsContext.Provider value={value}>
      {children}
    </UpcomingPredictionsContext.Provider>
  );
}
