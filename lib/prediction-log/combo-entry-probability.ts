import { comboGridProbabilityPercent } from "./combo-markets-config";
import { comboValue } from "./combo-probability";
import { findClubInIndex } from "./club-index";
import type { ClubIndex, ClubRecord } from "./club-record-types";
import { computeLeagueBaselines } from "./league-baselines";
import { resolveMarketMode, singleMarketKey } from "./match-entry-helpers";
import { computeDixonColes } from "./statistics-engine";
import type { LogMatch } from "./types";

export interface EntryLegProbability {
  pGrid: number | null;
  valueEdge: number | null;
  hasGrid: boolean;
  error?: string;
}

export function entryValueFromGrid(pGrid: number | null, odds: number | undefined): number | null {
  if (pGrid == null || odds == null || !Number.isFinite(odds)) return null;
  return comboValue(pGrid, odds);
}

export function computeEntryLegProbability(
  match: LogMatch,
  league: string,
  clubRecords: Record<string, ClubRecord>,
  clubIndex: ClubIndex | null,
  allBatches: import("./types").PredictionBatch[] = []
): EntryLegProbability {
  if (!match.homeTeam || !match.awayTeam) {
    return { pGrid: null, valueEdge: null, hasGrid: false, error: "Select teams" };
  }

  const homeEntry = clubIndex
    ? findClubInIndex(clubIndex, match.homeTeam, league)
    : null;
  const awayEntry = clubIndex
    ? findClubInIndex(clubIndex, match.awayTeam, league)
    : null;
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

  const leagueBaselines = computeLeagueBaselines(allBatches);
  const mode = resolveMarketMode(match);

  try {
    if (mode === "combined") {
      const comboId = match.comboPick?.comboId;
      if (!comboId) return { pGrid: null, valueEdge: null, hasGrid: false };

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
      const pGrid = comboGridProbabilityPercent(comboId, {
        grid: dc.scoreGrid,
        lambdaHome: dc.lambdaHome,
        lambdaAway: dc.lambdaAway,
      });
      const valueEdge = entryValueFromGrid(pGrid, match.comboPick?.odds);
      return { pGrid, valueEdge, hasGrid: pGrid != null };
    }

    const marketKey = singleMarketKey(match);
    if (!marketKey) return { pGrid: null, valueEdge: null, hasGrid: false };

    const pred = match.predictions[marketKey];
    if (!pred?.prediction) return { pGrid: null, valueEdge: null, hasGrid: false };

    const dc = computeDixonColes(
      homeRecord,
      awayRecord,
      league,
      marketKey,
      pred.prediction,
      pred.line,
      leagueBaselines,
      null
    );
    const pGrid = Math.round(dc.marketProb * 100);
    const valueEdge = entryValueFromGrid(pGrid, pred.odds);
    return { pGrid, valueEdge, hasGrid: true };
  } catch (e) {
    return {
      pGrid: null,
      valueEdge: null,
      hasGrid: false,
      error: e instanceof Error ? e.message : "Probability unavailable",
    };
  }
}

export function formatValueEdge(
  valueEdge: number | null,
  highlightPositive: boolean
): { text: string; color: string } {
  if (valueEdge == null) return { text: "—", color: "var(--muted)" };
  const sign = valueEdge >= 0 ? "+" : "";
  const text = `${sign}${valueEdge}%`;
  if (!highlightPositive) return { text, color: "var(--muted)" };
  if (valueEdge > 0) return { text, color: "var(--accent)" };
  if (valueEdge < 0) return { text, color: "var(--danger)" };
  return { text: "0.0%", color: "var(--muted)" };
}
