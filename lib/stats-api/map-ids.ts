import { teamNamesMatch } from "@/lib/livescore/resolve-match";
import type { StatsApiDayMatch } from "./types";

function dateKeyFromIso(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
    return m?.[1] ?? null;
  }
  return d.toISOString().slice(0, 10);
}

function dateKeyFromProvider(date: string | null): string | null {
  if (!date) return null;
  const trimmed = date.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

export interface AfFixtureIdentity {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  kickoffUtc: string;
  /** Cached Stats API match id if already known */
  statsApiMatchId?: string | null;
}

/**
 * Map API-Football fixtures to Stats API match ids by team names + date.
 */
export function mapStatsApiIds(
  fixtures: AfFixtureIdentity[],
  dayMatches: StatsApiDayMatch[]
): Map<number, string> {
  const out = new Map<number, string>();

  for (const fx of fixtures) {
    if (fx.statsApiMatchId != null && fx.statsApiMatchId.trim()) {
      out.set(fx.fixtureId, fx.statsApiMatchId.trim());
      continue;
    }

    const fxDate = dateKeyFromIso(fx.kickoffUtc);
    let best: StatsApiDayMatch | null = null;

    for (const bm of dayMatches) {
      if (!teamNamesMatch(fx.homeTeam, bm.homeTeam)) continue;
      if (!teamNamesMatch(fx.awayTeam, bm.awayTeam)) continue;
      const bmDate = dateKeyFromProvider(bm.date);
      if (fxDate && bmDate && fxDate !== bmDate) continue;
      best = bm;
      break;
    }

    if (!best && fxDate) {
      for (const bm of dayMatches) {
        const bmDate = dateKeyFromProvider(bm.date);
        if (bmDate !== fxDate) continue;
        if (
          teamNamesMatch(fx.homeTeam, bm.awayTeam) &&
          teamNamesMatch(fx.awayTeam, bm.homeTeam)
        ) {
          best = bm;
          break;
        }
      }
    }

    if (best) out.set(fx.fixtureId, best.id);
  }

  return out;
}
