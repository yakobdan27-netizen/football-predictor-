/**
 * Session cache for per-team / per-league half-goal splits.
 * 2H goals are always FT − HT. Built once per batch list fingerprint.
 */
import {
  computeLeagueHalfShare,
  computeTeamHalfShare,
  type HshLeagueHalfShare,
  type HshTeamHalfShare,
  type HshVenue,
} from "./hsh-model";
import type { PredictionBatch } from "./types";

export interface HalfSplitsCache {
  teamShare(
    team: string,
    venue: HshVenue,
    opts?: { limit?: number; beforeDate?: string; league?: string; season?: string | null }
  ): HshTeamHalfShare;
  leagueShare(
    league: string,
    opts?: { beforeDate?: string; season?: string | null }
  ): HshLeagueHalfShare;
}

function fingerprint(batches: PredictionBatch[]): string {
  let n = 0;
  let last = "";
  for (const b of batches) {
    n += b.matches.length;
    const stamp = b.settledAt ?? b.createdAt;
    if (stamp > last) last = stamp;
  }
  return `${batches.length}:${n}:${last}`;
}

const memo = new Map<string, HalfSplitsCache>();

export function buildHalfSplitsCache(batches: PredictionBatch[]): HalfSplitsCache {
  const key = fingerprint(batches);
  const hit = memo.get(key);
  if (hit) return hit;

  const teamMemo = new Map<string, HshTeamHalfShare>();
  const leagueMemo = new Map<string, HshLeagueHalfShare>();

  const cache: HalfSplitsCache = {
    teamShare(team, venue, opts) {
      const k = `${team.toLowerCase()}|${venue}|${opts?.beforeDate ?? ""}|${opts?.limit ?? ""}|${opts?.league ?? ""}|${opts?.season ?? ""}`;
      const existing = teamMemo.get(k);
      if (existing) return existing;
      const computed = computeTeamHalfShare(batches, team, venue, opts);
      teamMemo.set(k, computed);
      return computed;
    },
    leagueShare(league, opts) {
      const k = `${league}|${opts?.beforeDate ?? ""}|${opts?.season ?? ""}`;
      const existing = leagueMemo.get(k);
      if (existing) return existing;
      const computed = computeLeagueHalfShare(batches, league, opts);
      leagueMemo.set(k, computed);
      return computed;
    },
  };

  memo.clear();
  memo.set(key, cache);
  return cache;
}

/** Second-half goals from FT and HT (never negative). */
export function secondHalfGoals(ft: number, ht: number): number {
  if (!Number.isFinite(ft) || !Number.isFinite(ht)) return 0;
  return Math.max(0, ft - ht);
}

export function clearHalfSplitsCache(): void {
  memo.clear();
}
