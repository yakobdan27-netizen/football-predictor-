"use client";

import { useMemo } from "react";
import { matchLeague } from "@/lib/prediction-log/match-league";
import {
  computeLeagueHalfAverages,
  computeTeamHalfAverages,
  estimateTempoProfile,
  predictHalfComparison,
  type HcPrediction,
} from "@/lib/prediction-log/half-comparison-model";
import type { PredictionBatch } from "@/lib/prediction-log/types";

export function useHalfComparisonPredictions(
  batch: PredictionBatch | null,
  allBatches: PredictionBatch[]
): { predictions: HcPrediction[] } {
  const predictions = useMemo<HcPrediction[]>(() => {
    if (!batch) return [];

    return batch.matches.map((match) => {
      const league = matchLeague(match, batch.league);
      const homeAvg = computeTeamHalfAverages(allBatches, match.homeTeam, "home", {
        beforeDate: batch.date,
      });
      const awayAvg = computeTeamHalfAverages(allBatches, match.awayTeam, "away", {
        beforeDate: batch.date,
      });
      const leagueAvg = computeLeagueHalfAverages(allBatches, league, {
        beforeDate: batch.date,
      });
      const homeTempo = estimateTempoProfile(allBatches, match.homeTeam, {
        beforeDate: batch.date,
      });
      const awayTempo = estimateTempoProfile(allBatches, match.awayTeam, {
        beforeDate: batch.date,
      });

      return predictHalfComparison({
        matchId: match.id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        league,
        homeAvg,
        awayAvg,
        leagueAvg,
        homeTempo,
        awayTempo,
      });
    });
  }, [batch, allBatches]);

  return { predictions };
}
