"use client";

import { useMemo } from "react";
import { matchLeague } from "@/lib/prediction-log/match-league";
import { predictHighestScoringHalf, type HshPrediction } from "@/lib/prediction-log/hsh-model";
import {
  loadClubHalfAttackDefence,
  loadLeagueAfBaselines,
} from "@/lib/prediction-log/hsh-half-rates";
import type { PredictionBatch } from "@/lib/prediction-log/types";

export interface HshOverride {
  lambda1h?: number;
  lambda2h?: number;
}

export function useHshPredictions(
  batch: PredictionBatch | null,
  allBatches: PredictionBatch[],
  overrides: Record<string, HshOverride> = {}
): { predictions: HshPrediction[]; loading: boolean; error: string | null } {
  const predictions = useMemo<HshPrediction[]>(() => {
    if (!batch) return [];

    return batch.matches.map((match) => {
      const league = matchLeague(match, batch.league);
      const homeRates = loadClubHalfAttackDefence(match.homeTeam, league, allBatches, {
        beforeDate: batch.date,
      });
      const awayRates = loadClubHalfAttackDefence(match.awayTeam, league, allBatches, {
        beforeDate: batch.date,
      });
      const { lgAf1, lgAf2 } = loadLeagueAfBaselines(league);
      const override = overrides[match.id];

      return predictHighestScoringHalf({
        matchId: match.id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        league,
        homeRates,
        awayRates,
        lgAf1,
        lgAf2,
        manualLambda1h: override?.lambda1h,
        manualLambda2h: override?.lambda2h,
      });
    });
  }, [batch, allBatches, overrides]);

  return { predictions, loading: false, error: null };
}
