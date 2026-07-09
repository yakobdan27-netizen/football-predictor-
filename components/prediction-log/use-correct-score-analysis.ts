"use client";

import { useEffect, useMemo, useState } from "react";
import { analyzeCorrectScore, type CorrectScoreAnalysis } from "@/lib/prediction-log/correct-score";
import { scoreGridForMatch } from "@/lib/prediction-log/correct-score-freeze";
import { loadClubRecordsForBatch } from "@/lib/prediction-log/club-record-insights";
import {
  ensureStorageInit,
  loadBatches,
  refreshClubIndex,
  fetchClubRecord,
} from "@/lib/prediction-log/storage";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";

export function useCorrectScoreAnalysis(
  match: LogMatch,
  league: string,
  date: string
): { analysis: CorrectScoreAnalysis | null; loading: boolean; error?: string } {
  const [analysis, setAnalysis] = useState<CorrectScoreAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const depsKey = useMemo(
    () => JSON.stringify({ home: match.homeTeam, away: match.awayTeam }),
    [match.homeTeam, match.awayTeam]
  );

  useEffect(() => {
    if (!match.homeTeam || !match.awayTeam) {
      setAnalysis(null);
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
            id: "cs-stub",
            date,
            league,
            batchName: "entry",
            createdAt: new Date().toISOString(),
            batchKind: "manual",
            matches: [match],
          };
          const clubRecords = await loadClubRecordsForBatch(stub, clubIndex, fetchClubRecord);
          const grid = scoreGridForMatch(match, league, clubRecords, clubIndex, batches);
          const result = grid ? analyzeCorrectScore(grid) : null;
          if (!cancelled) {
            setAnalysis(result);
            setError(result ? undefined : "Could not build score grid");
          }
        } catch {
          if (!cancelled) {
            setAnalysis(null);
            setError("Could not load club data");
          }
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

  return { analysis, loading, error };
}
