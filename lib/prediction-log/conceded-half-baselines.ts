/**
 * Static multi-season conceded half-goals seed (prior, not scraped truth).
 * Blends with live batch HT samples by match-count weighting.
 */
import { standardizeTeamName } from "@/lib/data/team-names";
import baselinesJson from "@/data/conceded-half-baselines.json";

export interface ConcededHalfBaselineRow {
  league: string;
  season: string;
  clubName: string;
  matches: number;
  avgConceded: number;
  avg1hConceded: number;
  avg2hConceded: number;
  pct1hGt2h: number;
  pct1hEq2h: number;
  pct2hGt1h: number;
}

export interface ConcededRecencyBlend {
  clubName: string;
  league: string;
  seasonCount: number;
  avgConceded: number;
  avg1hConceded: number;
  avg2hConceded: number;
  pct1hGt2h: number;
  pct1hEq2h: number;
  pct2hGt1h: number;
  /** Effective seed match weight for live blend. */
  seedMatches: number;
  sourceLabel: string;
}

export type SeedConcededConfidence = "high" | "medium" | "low";

const SEASON_ORDER = ["2021/22", "2022/23", "2023/24", "2024/25", "2025/26"] as const;
const SEASON_WEIGHT: Record<string, number> = {
  "2021/22": 1,
  "2022/23": 2,
  "2023/24": 3,
  "2024/25": 4,
  "2025/26": 5,
};

const RAW_ROWS = baselinesJson as ConcededHalfBaselineRow[];

function clubKey(name: string): string {
  return standardizeTeamName(name).trim().toLowerCase();
}

function leagueKey(league: string): string {
  return league.trim().toLowerCase();
}

function seasonRank(season: string): number {
  const idx = SEASON_ORDER.indexOf(season as (typeof SEASON_ORDER)[number]);
  return idx >= 0 ? idx : -1;
}

const byClubLeague = new Map<string, ConcededHalfBaselineRow[]>();

for (const row of RAW_ROWS) {
  const ck = `${clubKey(row.clubName)}|${leagueKey(row.league)}`;
  const list = byClubLeague.get(ck) ?? [];
  list.push(row);
  byClubLeague.set(ck, list);
}
for (const list of byClubLeague.values()) {
  list.sort((a, b) => seasonRank(a.season) - seasonRank(b.season));
}

export function allConcededHalfBaselines(): readonly ConcededHalfBaselineRow[] {
  return RAW_ROWS;
}

export function lookupClubConcededBaseline(
  clubName: string,
  league: string,
  season?: string | null
): ConcededHalfBaselineRow | null {
  const list = byClubLeague.get(`${clubKey(clubName)}|${leagueKey(league)}`);
  if (!list || list.length === 0) {
    const key = clubKey(clubName);
    for (const [k, rows] of byClubLeague) {
      if (!k.startsWith(`${key}|`)) continue;
      if (season) {
        const hit = rows.find((r) => r.season === season);
        if (hit) return hit;
      }
      return rows[rows.length - 1] ?? null;
    }
    return null;
  }
  if (season) {
    const hit = list.find((r) => r.season === season);
    if (hit) return hit;
  }
  return list[list.length - 1] ?? null;
}

export function clubConcededSeasonRows(
  clubName: string,
  league: string
): ConcededHalfBaselineRow[] {
  return byClubLeague.get(`${clubKey(clubName)}|${leagueKey(league)}`) ?? [];
}

/** Recency-weighted mean across seasons (2025/26 weight 5 … 2021/22 weight 1). */
export function lookupClubConcededRecencyBlend(
  clubName: string,
  league: string
): ConcededRecencyBlend | null {
  const rows = clubConcededSeasonRows(clubName, league);
  if (rows.length === 0) return null;

  let wSum = 0;
  let avgC = 0;
  let avg1 = 0;
  let avg2 = 0;
  let p1 = 0;
  let pe = 0;
  let p2 = 0;
  let matchW = 0;

  for (const r of rows) {
    const w = SEASON_WEIGHT[r.season] ?? 1;
    wSum += w;
    avgC += r.avgConceded * w;
    avg1 += r.avg1hConceded * w;
    avg2 += r.avg2hConceded * w;
    p1 += r.pct1hGt2h * w;
    pe += r.pct1hEq2h * w;
    p2 += r.pct2hGt1h * w;
    matchW += r.matches * w;
  }

  const stdName = standardizeTeamName(rows[0]!.clubName);
  return {
    clubName: stdName,
    league: rows[0]!.league,
    seasonCount: rows.length,
    avgConceded: avgC / wSum,
    avg1hConceded: avg1 / wSum,
    avg2hConceded: avg2 / wSum,
    pct1hGt2h: p1 / wSum,
    pct1hEq2h: pe / wSum,
    pct2hGt1h: p2 / wSum,
    seedMatches: matchW / wSum,
    sourceLabel: `seed: ${stdName} (${rows.length} seasons)`,
  };
}

export function blendSeedAndLive(
  seedAvg: number,
  seedN: number,
  liveAvg: number,
  liveN: number
): number {
  const sn = Math.max(0, seedN);
  const ln = Math.max(0, liveN);
  const denom = sn + ln;
  if (denom <= 0) return liveAvg;
  return (seedAvg * sn + liveAvg * ln) / denom;
}

/**
 * Low — seed-only (liveMatches === 0) OR fewer than 3 season rows
 * High — ≥3 seasons AND |pct1hGt − pct2hGt| ≥ 8 on recency blend
 * Medium — otherwise
 */
export function seedConfidence(
  blend: ConcededRecencyBlend | null,
  liveMatches: number
): SeedConcededConfidence {
  if (!blend || liveMatches === 0 || blend.seasonCount < 3) return "low";
  const gap = Math.abs(blend.pct1hGt2h - blend.pct2hGt1h);
  if (blend.seasonCount >= 3 && gap >= 8) return "high";
  return "medium";
}

export function listSeedClubs(league?: string | null): ConcededHalfBaselineRow[] {
  if (!league) return [...RAW_ROWS];
  const lk = leagueKey(league);
  return RAW_ROWS.filter((r) => leagueKey(r.league) === lk);
}

export function listSeedSeasons(): string[] {
  return [...SEASON_ORDER].reverse();
}
