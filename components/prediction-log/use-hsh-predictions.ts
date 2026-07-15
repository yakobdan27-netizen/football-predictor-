"use client";

import { useEffect, useMemo, useState } from "react";
import { getStatEngineExtras, loadClubRecordsForBatchFromCache } from "@/lib/prediction-log/storage";
import { resolveMatchClubRecords } from "@/lib/prediction-log/correct-score-freeze";
import { computeLambdas } from "@/lib/prediction-log/statistics-engine";
import { matchLeague } from "@/lib/prediction-log/match-league";
import {
  computeLeagueHalfShare,
  computeTeamHalfShare,
  estimateRestDays,
  predictHighestScoringHalf,
  type HshPrediction,
} from "@/lib/prediction-log/hsh-model";
import type { ClubIndex, ClubRecord } from "@/lib/prediction-log/club-record-types";
import type { PredictionBatch } from "@/lib/prediction-log/types";

export interface HshOverride {
  lambda1h?: number;
  lambda2h?: number;
}

export function useHshPredictions(
  batch: PredictionBatch | null,
  allBatches: PredictionBatch[],
  clubIndex: ClubIndex | null,
  overrides: Record<string, HshOverride>
): { predictions: HshPrediction[]; loading: boolean; error: string | null } {
  const [clubRecords, setClubRecords] = useState<Record<string, ClubRecord>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!batch) {
      setClubRecords({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadClubRecordsForBatchFromCache(batch)
      .then((records) => {
        if (!cancelled) setClubRecords(records);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load club history for this batch");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [batch]);

  const predictions = useMemo<HshPrediction[]>(() => {
    if (!batch) return [];
    const { leagueBaselines, leagueProfiles } = getStatEngineExtras();

    return batch.matches.map((match) => {
      const league = matchLeague(match, batch.league);
      const { home, away } = resolveMatchClubRecords(match, league, clubRecords, clubIndex);
      const { lambdaHome, lambdaAway } = computeLambdas(
        home?.statMetadata,
        away?.statMetadata,
        leagueBaselines,
        league,
        leagueProfiles?.leagues?.[league]?.characterProfile
      );

      const homeHalfShare = computeTeamHalfShare(allBatches, match.homeTeam, "home", {
        beforeDate: batch.date,
      });
      const awayHalfShare = computeTeamHalfShare(allBatches, match.awayTeam, "away", {
        beforeDate: batch.date,
      });
      const leagueHalfShare = computeLeagueHalfShare(allBatches, league, {
        beforeDate: batch.date,
      });
      const restDaysHome = estimateRestDays(allBatches, match.homeTeam, batch.date);
      const restDaysAway = estimateRestDays(allBatches, match.awayTeam, batch.date);

      const override = overrides[match.id];

      return predictHighestScoringHalf({
        matchId: match.id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        league,
        xgHome: lambdaHome,
        xgAway: lambdaAway,
        homeHalfShare,
        awayHalfShare,
        leagueHalfShare,
        restDaysHome,
        restDaysAway,
        manualLambda1h: override?.lambda1h,
        manualLambda2h: override?.lambda2h,
      });
    });
  }, [batch, allBatches, clubRecords, clubIndex, overrides]);

  return { predictions, loading, error };
}
