import {
  HISTORY_TYPE_KEYS,
  type ClubCapacity,
  type ClubHistories,
  type ClubRecord,
  type HistoryEntry,
  type HistoryTypeKey,
} from "./club-record-types";
import { applyStatMetadata } from "./club-stat-metadata";
import type { LeagueBaselinesStore } from "./league-baselines";
import type { TeamsQualityStore } from "./teams-quality-types";

const RECENT_N = 6;
const LOW_SAMPLE_THRESHOLD = 5;

function activeEntries(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.filter((e) => !e.superseded);
}

function resolved(entries: HistoryEntry[]): HistoryEntry[] {
  return activeEntries(entries).filter((e) => e.result === "hit" || e.result === "miss");
}

function hitRate(entries: HistoryEntry[]): number | null {
  const r = resolved(entries);
  if (!r.length) return null;
  const hits = r.filter((e) => e.result === "hit").length;
  return Math.round((hits / r.length) * 100);
}

function venueEntries(entries: HistoryEntry[], venue: "home" | "away"): HistoryEntry[] {
  return resolved(entries).filter((e) => e.venue === venue);
}

function avgNumeric(entries: HistoryEntry[], field: "actual" | "predicted" = "actual"): number {
  const nums = resolved(entries)
    .map((e) => {
      const v = field === "actual" ? e.actual : e.predicted;
      return typeof v === "number" ? v : parseFloat(String(v));
    })
    .filter((n) => Number.isFinite(n));
  if (!nums.length) return 0;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

function recentFormScore(record: ClubRecord): number {
  const all: HistoryEntry[] = [];
  for (const type of HISTORY_TYPE_KEYS) {
    all.push(...resolved(record.histories[type]));
  }
  all.sort((a, b) => b.date.localeCompare(a.date));
  const recent = all.slice(0, RECENT_N);
  if (!recent.length) return 5;
  const hits = recent.filter((e) => e.result === "hit").length;
  return Math.round((hits / recent.length) * 10);
}

function winLoseRates(histories: ClubHistories): {
  overall: number;
  home: number;
  away: number;
} {
  const wl = resolved(histories.winLose);
  const home = venueEntries(histories.winLose, "home");
  const away = venueEntries(histories.winLose, "away");

  const winPct = (list: HistoryEntry[]) => {
    if (!list.length) return 0;
    const wins = list.filter((e) => e.actual === "win" || e.predicted === "win").length;
    const hits = list.filter((e) => e.result === "hit").length;
    return hits > 0 ? Math.round((hits / list.length) * 100) : wins > 0 ? Math.round((wins / list.length) * 100) : 0;
  };

  return {
    overall: hitRate(wl) ?? 0,
    home: winPct(home),
    away: winPct(away),
  };
}

function cleanSheetRate(histories: ClubHistories): number {
  const cs = resolved(histories.cleanSheet);
  if (cs.length) return hitRate(cs) ?? 0;
  const conceded = resolved(histories.goalsConceded);
  if (!conceded.length) return 0;
  const clean = conceded.filter((e) => {
    const a = typeof e.actual === "number" ? e.actual : parseFloat(String(e.actual ?? ""));
    return Number.isFinite(a) && a === 0;
  }).length;
  return Math.round((clean / conceded.length) * 100);
}

export function recomputeCapacity(record: ClubRecord): ClubCapacity {
  const { histories } = record;
  const rates = winLoseRates(histories);
  const accuracy: Partial<Record<HistoryTypeKey, number>> = {};

  for (const type of HISTORY_TYPE_KEYS) {
    const hr = hitRate(histories[type]);
    if (hr != null) accuracy[type] = hr;
  }

  let sampleSize = 0;
  for (const type of HISTORY_TYPE_KEYS) {
    sampleSize = Math.max(sampleSize, resolved(histories[type]).length);
  }

  return {
    winRate: rates.overall,
    homeWinRate: rates.home,
    awayWinRate: rates.away,
    avgShotsOnTarget: avgNumeric(histories.shotsOnTarget),
    avgGoalsScored: avgNumeric(histories.goalsScored),
    avgGoalsConceded: avgNumeric(histories.goalsConceded),
    cleanSheetRate: cleanSheetRate(histories),
    avgYellowCards: avgNumeric(histories.yellowCards),
    avgRedCards: avgNumeric(histories.redCards),
    avgCorners: avgNumeric(histories.corners),
    avgOffsides: avgNumeric(histories.offsides),
    avgFouls: avgNumeric(histories.fouls),
    avgPossession: avgNumeric(histories.possession),
    recentForm: recentFormScore(record),
    predictionAccuracyByType: accuracy,
    sampleSize,
    lowSample: sampleSize < LOW_SAMPLE_THRESHOLD,
  };
}

export function applyCapacity(
  record: ClubRecord,
  leagueBaselines: LeagueBaselinesStore | null = null,
  teamsQuality: TeamsQualityStore | null = null
): ClubRecord {
  const updated = {
    ...record,
    capacity: recomputeCapacity(record),
    lastUpdated: new Date().toISOString(),
  };
  return applyStatMetadata(updated, leagueBaselines, teamsQuality);
}
