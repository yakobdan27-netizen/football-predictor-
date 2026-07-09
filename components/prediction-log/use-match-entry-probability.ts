"use client";

import { useEffect, useMemo, useState } from "react";
import { computeEntryLegProbability, type EntryLegProbability } from "@/lib/prediction-log/combo-entry-probability";
import { loadClubRecordsForBatch } from "@/lib/prediction-log/club-record-insights";
import {
  ensureStorageInit,
  loadBatches,
  refreshClubIndex,
  fetchClubRecord,
} from "@/lib/prediction-log/storage";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";

const EMPTY: EntryLegProbability = { pGrid: null, valueEdge: null, hasGrid: false };

export function useMatchEntryProbability(
  match: LogMatch,
  league: string,
  date: string
): EntryLegProbability & { loading: boolean } {
  const [result, setResult] = useState<EntryLegProbability>(EMPTY);
  const [loading, setLoading] = useState(false);

  const depsKey = useMemo(
    () =>
      JSON.stringify({
        home: match.homeTeam,
        away: match.awayTeam,
        mode: match.marketMode,
        comboId: match.comboPick?.comboId,
        comboOdds: match.comboPick?.odds,
        predictions: match.predictions,
      }),
    [match]
  );

  useEffect(() => {
    if (!match.homeTeam || !match.awayTeam) {
      setResult(EMPTY);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(() => {
      void (async () => {
        try {
          await ensureStorageInit();
          const batches = loadBatches();
          const clubIndex = await refreshClubIndex();
          const stub: PredictionBatch = {
            id: "entry-stub",
            date,
            league,
            batchName: "entry",
            createdAt: new Date().toISOString(),
            batchKind: "manual",
            matches: [match],
          };
          const clubRecords = await loadClubRecordsForBatch(stub, clubIndex, fetchClubRecord);
          const prob = computeEntryLegProbability(match, league, clubRecords, clubIndex, batches);
          if (!cancelled) setResult(prob);
        } catch {
          if (!cancelled) setResult({ ...EMPTY, error: "Could not load club data" });
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [depsKey, league, date, match]);

  return { ...result, loading };
}
