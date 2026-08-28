"use client";

import { useMemo, useState } from "react";
import type { PredictionBatch } from "@/lib/prediction-log/types";
import { usePredictionLogData } from "./use-prediction-log-data";
import {
  usePreparedComboBatch,
  usePreparedComboBatches,
} from "./use-prepared-combo-batches";
import { useSelectedBatchId } from "./use-selected-batch-id";
import { useWeekendPicksBatch } from "./use-weekend-picks-batch";

export type ComboFixtureSource = "weekend" | "saved";

export function useComboFixtureBatch() {
  const { batches } = usePredictionLogData();
  const weekend = useWeekendPicksBatch();
  const [fixtureSource, setFixtureSource] =
    useState<ComboFixtureSource>("weekend");

  const { preparedBatches, preparing: preparingSaved } =
    usePreparedComboBatches(batches);

  const sortedEligible = useMemo(
    () =>
      [...preparedBatches].sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.date.localeCompare(a.date)
      ),
    [preparedBatches]
  );

  const { batchId, setBatchId, selected: selectedSaved } =
    useSelectedBatchId(sortedEligible);

  const { preparedBatch: preparedWeekend, preparing: preparingWeekend } =
    usePreparedComboBatch(
      fixtureSource === "weekend" ? weekend.batch : null,
      batches
    );

  const activeBatch: PredictionBatch | null =
    fixtureSource === "weekend" ? preparedWeekend : selectedSaved;

  const preparing =
    fixtureSource === "weekend" ? preparingWeekend : preparingSaved;
  const loading = fixtureSource === "weekend" && weekend.loading;

  return {
    fixtureSource,
    setFixtureSource,
    batchId,
    setBatchId,
    sortedEligible,
    activeBatch,
    weekend,
    loading,
    preparing,
  };
}
