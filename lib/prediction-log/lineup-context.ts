import type { ClubLineupSnapshot, ClubRecord } from "./club-record-types";

export interface LineupSignalResult {
  value: number;
  reliability: number;
}

function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function xiOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b.map(normName));
  let hit = 0;
  for (const p of a) {
    if (setB.has(normName(p))) hit++;
  }
  return hit / Math.max(a.length, b.length);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function clubLineupStability(snaps: ClubLineupSnapshot[] | undefined): LineupSignalResult {
  if (!snaps || snaps.length < 2) return { value: 0.5, reliability: 0 };
  const sorted = [...snaps].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1]!;
  const prev = sorted[sorted.length - 2]!;
  const overlap = xiOverlap(latest.starting, prev.starting);
  const sameFormation =
    latest.formation && prev.formation && latest.formation === prev.formation ? 1 : 0.5;
  const value = clamp01(0.55 * overlap + 0.45 * sameFormation);
  return { value, reliability: Math.min(1, snaps.length / 4) };
}

/**
 * Soft supportive signal from recent club lineups/formations.
 * Reliability 0 when either club has fewer than 2 snapshots.
 */
export function computeLineupContextSignal(
  homeRecord: ClubRecord | null,
  awayRecord: ClubRecord | null
): LineupSignalResult {
  const home = clubLineupStability(homeRecord?.recentLineups);
  const away = clubLineupStability(awayRecord?.recentLineups);
  if (home.reliability === 0 || away.reliability === 0) {
    return { value: 0.5, reliability: 0 };
  }
  return {
    value: (home.value + away.value) / 2,
    reliability: Math.min(home.reliability, away.reliability),
  };
}
