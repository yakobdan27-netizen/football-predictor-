"use client";

import { useEffect, useMemo, useState } from "react";
import type { PredictionBatch } from "@/lib/prediction-log/types";
import { usePredictionLogData } from "./use-prediction-log-data";
import { useWeekendPicksBatch } from "./use-weekend-picks-batch";

export type FixtureSource = "weekend" | "saved";

export function useAnalysisFixtureBatch() {
  const { batches } = usePredictionLogData();
  const weekend = useWeekendPicksBatch();
  const [fixtureSource, setFixtureSource] = useState<FixtureSource>("weekend");
  const [batchId, setBatchId] = useState("");

  const sortedBatches = useMemo(
    () =>
      [...batches].sort(
        (a, b) =>
          b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
      ),
    [batches]
  );

  useEffect(() => {
    if (!batchId && sortedBatches[0]) setBatchId(sortedBatches[0].id);
  }, [sortedBatches, batchId]);

  const savedBatch = sortedBatches.find((b) => b.id === batchId) ?? null;
  const batch: PredictionBatch | null =
    fixtureSource === "weekend" ? weekend.batch : savedBatch;

  const loading = fixtureSource === "weekend" && weekend.loading;

  return {
    fixtureSource,
    setFixtureSource,
    batchId,
    setBatchId,
    sortedBatches,
    batch,
    weekend,
    loading,
  };
}
