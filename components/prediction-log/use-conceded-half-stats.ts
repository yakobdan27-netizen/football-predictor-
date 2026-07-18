"use client";

import { useMemo } from "react";
import {
  aggregateConcededHalfStats,
  buildConcededMatchLog,
  listLeaguesFromLog,
  listSeasonsFromLog,
  predictConcededHalfMatch,
  type ConcededHalfPrediction,
  type ConcededHalfTeamStats,
  type ConcededMatchLogRow,
} from "@/lib/prediction-log/conceded-half-model";
import { matchLeague } from "@/lib/prediction-log/match-league";
import type { PredictionBatch } from "@/lib/prediction-log/types";

export function useConcededHalfStats(
  batches: PredictionBatch[],
  filters: { league: string | null; season: string | "all" }
): {
  logRows: ConcededMatchLogRow[];
  teamStats: ConcededHalfTeamStats[];
  leagues: string[];
  seasons: string[];
} {
  const logRows = useMemo(() => buildConcededMatchLog(batches), [batches]);

  const leagues = useMemo(() => listLeaguesFromLog(logRows), [logRows]);
  const seasons = useMemo(() => listSeasonsFromLog(logRows), [logRows]);

  const teamStats = useMemo(
    () =>
      aggregateConcededHalfStats(logRows, {
        league: filters.league,
        season: filters.season,
      }),
    [logRows, filters.league, filters.season]
  );

  return { logRows, teamStats, leagues, seasons };
}

export function useConcededHalfPredictions(
  batch: PredictionBatch | null,
  allBatches: PredictionBatch[],
  logRows: ConcededMatchLogRow[]
): ConcededHalfPrediction[] {
  return useMemo(() => {
    if (!batch) return [];
    return batch.matches.map((match) => {
      const league = matchLeague(match, batch.league);
      return predictConcededHalfMatch({
        matchId: match.id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        league,
        batches: allBatches,
        beforeDate: batch.date,
        logRows,
      });
    });
  }, [batch, allBatches, logRows]);
}
