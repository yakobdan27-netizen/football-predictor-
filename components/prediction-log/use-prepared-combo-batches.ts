"use client";

import { useEffect, useMemo, useState } from "react";
import {
  attachComboScoreGrids,
  batchEligibleForComboView,
  ensureComboRecommendedShell,
  matchesNeedingComboGrid,
} from "@/lib/prediction-log/prepare-batch-combos";
import { fetchMatchCentreRatesCache } from "@/components/prediction-log/use-match-centre-rates-cache";
import { loadClubRecordsForBatch } from "@/lib/prediction-log/club-record-insights";
import {
  fetchClubRecord,
  loadClubRecordsForBatchFromCache,
  refreshClubIndex,
} from "@/lib/prediction-log/storage";
import type { PredictionBatch } from "@/lib/prediction-log/types";

/** Shell + score grids for one batch (club first, then hist-weighted). */
export async function prepareComboBatch(
  batch: PredictionBatch,
  allBatches: PredictionBatch[]
): Promise<PredictionBatch> {
  const shelled = ensureComboRecommendedShell(batch);
  try {
    const clubIndex = await refreshClubIndex();
    const clubRecords =
      (await loadClubRecordsForBatchFromCache(shelled).catch(() => null)) ??
      (await loadClubRecordsForBatch(shelled, clubIndex, fetchClubRecord));
    const matchCentreCache = await fetchMatchCentreRatesCache(shelled);
    let withGrids = attachComboScoreGrids(
      shelled,
      clubRecords,
      clubIndex,
      allBatches,
      undefined,
      { matchCentreCache }
    );
    const needHist = matchesNeedingComboGrid(withGrids);
    if (needHist.length > 0) {
      try {
        const res = await fetch("/api/hist/combo-grids", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matches: needHist }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            grids?: Record<string, number[][]>;
          };
          if (data.grids && Object.keys(data.grids).length > 0) {
            withGrids = attachComboScoreGrids(
              withGrids,
              clubRecords,
              clubIndex,
              allBatches,
              data.grids,
              { matchCentreCache }
            );
          }
        }
      } catch {
        // hist optional — keep club-only grids
      }
    }
    return withGrids;
  } catch {
    return shelled;
  }
}

/** Prepare a single active batch (e.g. Weekend Picks in memory). */
export function usePreparedComboBatch(
  batch: PredictionBatch | null,
  allBatches: PredictionBatch[]
) {
  const [prepared, setPrepared] = useState<PredictionBatch | null>(() =>
    batch ? ensureComboRecommendedShell(batch) : null
  );
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    if (!batch) {
      setPrepared(null);
      return;
    }
    let cancelled = false;
    setPrepared(ensureComboRecommendedShell(batch));

    async function run() {
      setPreparing(true);
      try {
        const next = await prepareComboBatch(batch!, allBatches);
        if (!cancelled) setPrepared(next);
      } finally {
        if (!cancelled) setPreparing(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [batch, allBatches]);

  return { preparedBatch: prepared, preparing };
}

/**
 * Prepare every batch with matches for Combined Odds:
 * shell recommended fixtures + attach score grids (club first, then hist-weighted).
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
        const next: PredictionBatch[] = [];
        for (const batch of eligible) {
          next.push(await prepareComboBatch(batch, batches));
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
