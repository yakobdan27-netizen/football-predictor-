"use client";

import { useEffect, useMemo, useState } from "react";
import {
  attachComboScoreGrids,
  batchEligibleForComboView,
  ensureComboRecommendedShell,
} from "@/lib/prediction-log/prepare-batch-combos";
import { loadClubRecordsForBatch } from "@/lib/prediction-log/club-record-insights";
import {
  fetchClubRecord,
  loadClubRecordsForBatchFromCache,
  refreshClubIndex,
} from "@/lib/prediction-log/storage";
import type { PredictionBatch } from "@/lib/prediction-log/types";

/**
 * Prepare every batch with matches for Combined Odds:
 * shell recommended fixtures + attach score grids (async).
 */
export function usePreparedComboBatches(batches: PredictionBatch[]) {
  const eligible = useMemo(
    () =>
      batches
        .filter(batchEligibleForComboView)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [batches]
  );

  const [prepared, setPrepared] = useState<PredictionBatch[]>(() =>
    eligible.map(ensureComboRecommendedShell)
  );
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPrepared(eligible.map(ensureComboRecommendedShell));

    async function run() {
      setPreparing(true);
      try {
        const clubIndex = await refreshClubIndex();
        const next: PredictionBatch[] = [];
        for (const batch of eligible) {
          const shelled = ensureComboRecommendedShell(batch);
          try {
            const clubRecords =
              (await loadClubRecordsForBatchFromCache(shelled).catch(() => null)) ??
              (await loadClubRecordsForBatch(shelled, clubIndex, fetchClubRecord));
            next.push(attachComboScoreGrids(shelled, clubRecords, clubIndex, batches));
          } catch {
            next.push(shelled);
          }
        }
        if (!cancelled) setPrepared(next);
      } finally {
        if (!cancelled) setPreparing(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [eligible, batches]);

  return { preparedBatches: prepared, preparing };
}
