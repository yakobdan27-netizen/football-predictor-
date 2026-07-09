import {
  analyzeCorrectScore,
  analysisToSnapshot,
  scorelineProbPct,
} from "./correct-score";
import { entryValueFromGrid } from "./combo-entry-probability";
import { computeDixonColes } from "./statistics-engine";
import { computeLeagueBaselines } from "./league-baselines";
import { findClubInIndex } from "./club-index";
import type { ClubIndex, ClubRecord } from "./club-record-types";
import type { LogMatch, PredictionBatch } from "./types";

export function scoreGridForMatch(
  match: LogMatch,
  league: string,
  clubRecords: Record<string, ClubRecord>,
  clubIndex: ClubIndex | null,
  allBatches: PredictionBatch[] = []
): number[][] | null {
  if (!match.homeTeam || !match.awayTeam) return null;

  const homeEntry = clubIndex ? findClubInIndex(clubIndex, match.homeTeam, league) : null;
  const awayEntry = clubIndex ? findClubInIndex(clubIndex, match.awayTeam, league) : null;
  const homeRecord = match.homeClubId
    ? clubRecords[match.homeClubId]
    : homeEntry
      ? clubRecords[homeEntry.clubId]
      : null;
  const awayRecord = match.awayClubId
    ? clubRecords[match.awayClubId]
    : awayEntry
      ? clubRecords[awayEntry.clubId]
      : null;

  try {
    const leagueBaselines = computeLeagueBaselines(allBatches);
    const dc = computeDixonColes(
      homeRecord,
      awayRecord,
      league,
      "1x2",
      "home",
      undefined,
      leagueBaselines,
      null
    );
    return dc.scoreGrid;
  } catch {
    return null;
  }
}

export function freezeCorrectScoreOnMatch(
  match: LogMatch,
  grid: number[][] | null
): LogMatch {
  if (!grid) return match;

  const analysis = analyzeCorrectScore(grid);
  if (!analysis) return match;

  const next: LogMatch = {
    ...match,
    correctScoreSnapshot: analysisToSnapshot(analysis),
  };

  if (match.correctScorePick) {
    const probPct = scorelineProbPct(grid, match.correctScorePick.home, match.correctScorePick.away);
    next.correctScorePick = {
      ...match.correctScorePick,
      systemProbability: probPct,
      valueEdge: entryValueFromGrid(probPct, match.correctScorePick.odds) ?? undefined,
    };
  }

  return next;
}

export function freezeCorrectScoreOnMatches(
  matches: LogMatch[],
  league: string,
  clubRecords: Record<string, ClubRecord>,
  clubIndex: ClubIndex | null,
  allBatches: PredictionBatch[]
): LogMatch[] {
  return matches.map((m) => {
    const grid = scoreGridForMatch(m, league, clubRecords, clubIndex, allBatches);
    return freezeCorrectScoreOnMatch(m, grid);
  });
}

export function attachCorrectScoreToBatch(batch: PredictionBatch): PredictionBatch {
  const gridByMatch = new Map<string, number[][]>();
  for (const rm of batch.recommended?.matches ?? []) {
    for (const pick of Object.values(rm.predictions)) {
      const grid = pick?.mathSnapshot?.statLayer?.scoreGrid;
      if (grid) gridByMatch.set(rm.id, grid);
    }
  }

  const matches = batch.matches.map((m) => {
    const grid = gridByMatch.get(m.id);
    if (grid) return freezeCorrectScoreOnMatch(m, grid);
    return m;
  });

  return { ...batch, matches };
}

export function concentrationFromGrid(grid: number[][] | null | undefined): number | null {
  if (!grid) return null;
  const analysis = analyzeCorrectScore(grid);
  return analysis?.concentrationIndex ?? null;
}
