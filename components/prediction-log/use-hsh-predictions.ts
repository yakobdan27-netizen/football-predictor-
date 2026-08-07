"use client";

import { useMemo } from "react";
import { matchLeague } from "@/lib/prediction-log/match-league";
import {
  computeCanonicalHshPrediction,
  canonicalProbabilityFromHsh,
} from "@/lib/prediction-log/canonical-probability";
import {
  loadClubHalfAttackDefence,
  loadLeagueAfBaselines,
} from "@/lib/prediction-log/hsh-half-rates";
import { estimateTempoProfile } from "@/lib/prediction-log/half-tempo";
import type { HshPrediction } from "@/lib/prediction-log/hsh-model";
import type { BlendSource } from "@/lib/prediction-log/prediction-weights";
import type { PredictionBatch } from "@/lib/prediction-log/types";

export interface HshOverride {
  lambda1h?: number;
  lambda2h?: number;
}

export type HshPredictionWithBlend = HshPrediction & {
  sourceBreakdown: BlendSource;
};

/**
 * Half-Time Ranking predictions via canonical half engine
 * (predictHighestScoringHalf / Stage A+B only).
 */
export function useHshPredictions(
  batch: PredictionBatch | null,
  allBatches: PredictionBatch[],
  overrides: Record<string, HshOverride> = {}
): {
  predictions: HshPredictionWithBlend[];
  loading: boolean;
  error: string | null;
} {
  const predictions = useMemo<HshPredictionWithBlend[]>(() => {
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
      const homeTempo = estimateTempoProfile(allBatches, match.homeTeam, {
        beforeDate: batch.date,
      });
      const awayTempo = estimateTempoProfile(allBatches, match.awayTeam, {
        beforeDate: batch.date,
      });
      const override = overrides[match.id];

      const pred = computeCanonicalHshPrediction({
        matchId: match.id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        league,
        homeRates,
        awayRates,
        lgAf1,
        lgAf2,
        homeTempo,
        awayTempo,
        manualLambda1h: override?.lambda1h,
        manualLambda2h: override?.lambda2h,
      });
      const canon = canonicalProbabilityFromHsh(pred, "hsh_2h_gt_1h");
      return { ...pred, sourceBreakdown: canon.sourceBreakdown };
    });
  }, [batch, allBatches, overrides]);

  return { predictions, loading: false, error: null };
}
