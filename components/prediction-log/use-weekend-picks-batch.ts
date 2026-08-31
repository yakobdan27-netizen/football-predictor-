"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { WeekendOpportunityRow } from "@/lib/match-centre/weekend-opportunities";
import { buildWeekendPicksBatchFromRows } from "@/lib/prediction-log/weekend-picks-batch";
import type { WeekendLearnerSyncResult } from "@/lib/prediction-log/weekend-analysis-learner";
import { reloadBatchesFromServer } from "@/lib/prediction-log/storage";
import type { PredictionBatch } from "@/lib/prediction-log/types";

export type WeekendPicksApiResponse = {
  ok?: boolean;
  error?: string;
  generatedAt?: string;
  window?: { from: string; to: string };
  fixturePoolCount?: number;
  selectedCount?: number;
  insufficientPool?: boolean;
  rows?: WeekendOpportunityRow[];
  warnings?: string[];
  learnerSync?: WeekendLearnerSyncResult | null;
  weekendBatchId?: string;
};

export function useWeekendPicksBatch(): {
  batch: PredictionBatch | null;
  rows: WeekendOpportunityRow[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  warnings: string[];
  window: { from: string; to: string } | null;
  fixturePoolCount: number;
  generatedAt: string | null;
  learnerSync: WeekendPicksApiResponse["learnerSync"];
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<WeekendPicksApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [learnerSync, setLearnerSync] = useState<
    WeekendPicksApiResponse["learnerSync"]
  >(null);

  const load = useCallback(async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const q = refresh ? "?refresh=1" : "";
      const res = await fetch(`/api/match-centre/weekend-opportunities${q}`);
      const json = (await res.json()) as WeekendPicksApiResponse;
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not load Weekend Picks fixtures");
        setData(null);
        return;
      }
      setData(json);
      setLearnerSync(json.learnerSync ?? null);
      if (json.learnerSync?.saved) {
        await reloadBatchesFromServer().catch(() => {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Weekend Picks fixtures");
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const rows = data?.rows ?? [];
  const batch = useMemo(() => {
    if (rows.length === 0) return null;
    const batchId =
      data?.weekendBatchId ??
      `WEEKEND-${rows[0]!.kickoffIso.slice(0, 10)}`;
    return buildWeekendPicksBatchFromRows(rows, { batchId });
  }, [rows, data?.weekendBatchId]);

  const refresh = useCallback(async () => {
    await load(true);
  }, [load]);

  return {
    batch,
    rows,
    loading,
    refreshing,
    error,
    warnings: data?.warnings ?? [],
    window: data?.window ?? null,
    fixturePoolCount: data?.fixturePoolCount ?? rows.length,
    generatedAt: data?.generatedAt ?? null,
    learnerSync,
    refresh,
  };
}
