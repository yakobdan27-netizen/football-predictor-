/**
 * Static multi-season corners won/conceded seed (prior, not scraped truth).
 * Blends with live batch teamStats.corners by match-count weighting.
 */
import { standardizeTeamName } from "@/lib/data/team-names";
import baselinesJson from "@/data/corners-baselines.json";
import { blendSeedAndLive } from "./conceded-half-baselines";

export interface CornersBaselineRow {
  league: string;
  season: string;
  clubName: string;
  matches: number;
  avgCornersWon: number;
  avgCornersConceded: number;
  cornerDiff: number;
  pctMatchesOver95Total: number;
  pctMatchesOver45Team: number;
}

export interface CornersRecencyBlend {
  clubName: string;
  league: string;
  seasonCount: number;
  avgCornersWon: number;
  avgCornersConceded: number;
  cornerDiff: number;
  pctMatchesOver95Total: number;
  pctMatchesOver45Team: number;
  /** Stdev of season cornerDiff (stability metric). */
  cornerDiffStdev: number;
  seedMatches: number;
  sourceLabel: string;
}

export type CornersSeedConfidence = "high" | "medium" | "low";

const SEASON_ORDER = ["2021/22", "2022/23", "2023/24", "2024/25", "2025/26"] as const;
const SEASON_WEIGHT: Record<string, number> = {
  "2021/22": 1,
  "2022/23": 2,
  "2023/24": 3,
  "2024/25": 4,
  "2025/26": 5,
};

const DIFF_STDEV_STABLE = 0.8;

const RAW_ROWS = baselinesJson as CornersBaselineRow[];

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

function stdev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const varSum = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(varSum);
}

const byClubLeague = new Map<string, CornersBaselineRow[]>();
const byLeagueSeason = new Map<string, CornersBaselineRow[]>();

for (const row of RAW_ROWS) {
  const ck = `${clubKey(row.clubName)}|${leagueKey(row.league)}`;
  const clubList = byClubLeague.get(ck) ?? [];
  clubList.push(row);
  byClubLeague.set(ck, clubList);

  const lk = `${leagueKey(row.league)}|${row.season}`;
  const leagueList = byLeagueSeason.get(lk) ?? [];
  leagueList.push(row);
  byLeagueSeason.set(lk, leagueList);
}
for (const list of byClubLeague.values()) {
  list.sort((a, b) => seasonRank(a.season) - seasonRank(b.season));
}

export { blendSeedAndLive };

export function allCornersBaselines(): readonly CornersBaselineRow[] {
  return RAW_ROWS;
}

export function clubCornersSeasonRows(clubName: string, league: string): CornersBaselineRow[] {
  return byClubLeague.get(`${clubKey(clubName)}|${leagueKey(league)}`) ?? [];
}

export function lookupClubCornersBaseline(
  clubName: string,
  league: string,
  season?: string | null
): CornersBaselineRow | null {
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

/** Recency-weighted mean across seasons (2025/26 weight 5 … 2021/22 weight 1). */
export function lookupClubCornersRecencyBlend(
  clubName: string,
  league: string
): CornersRecencyBlend | null {
  let rows = clubCornersSeasonRows(clubName, league);
  if (rows.length === 0) {
    const key = clubKey(clubName);
    for (const [k, list] of byClubLeague) {
      if (!k.startsWith(`${key}|`)) continue;
      rows = list;
      break;
    }
  }
  if (rows.length === 0) return null;

  let wSum = 0;
  let won = 0;
  let conc = 0;
  let diff = 0;
  let over95 = 0;
  let over45 = 0;
  let matchW = 0;
  for (const r of rows) {
    const w = SEASON_WEIGHT[r.season] ?? 1;
    wSum += w;
    won += r.avgCornersWon * w;
    conc += r.avgCornersConceded * w;
    diff += r.cornerDiff * w;
    over95 += r.pctMatchesOver95Total * w;
    over45 += r.pctMatchesOver45Team * w;
    matchW += r.matches * w;
  }

  const stdName = standardizeTeamName(rows[0]!.clubName);
  return {
    clubName: stdName,
    league: rows[0]!.league,
    seasonCount: rows.length,
    avgCornersWon: won / wSum,
    avgCornersConceded: conc / wSum,
    cornerDiff: diff / wSum,
    pctMatchesOver95Total: over95 / wSum,
    pctMatchesOver45Team: over45 / wSum,
    cornerDiffStdev: stdev(rows.map((r) => r.cornerDiff)),
    seedMatches: matchW / wSum,
    sourceLabel: `seed: ${stdName} (${rows.length} seasons)`,
  };
}

/** League base = recency-weighted mean of club avgCornersWon. */
export function lookupLeagueCornersBaseline(league: string): { leagueBase: number } | null {
  const lk = leagueKey(league);
  let wSum = 0;
  let s = 0;
  for (const [key, rows] of byLeagueSeason) {
    if (!key.startsWith(`${lk}|`)) continue;
    const season = key.slice(lk.length + 1);
    const w = SEASON_WEIGHT[season] ?? 1;
    const avgWon = rows.reduce((a, r) => a + r.avgCornersWon, 0) / rows.length;
    wSum += w;
    s += avgWon * w;
  }
  if (wSum <= 0) return null;
  return { leagueBase: s / wSum };
}

/**
 * Low — no blend, seasonCount < 2, or single seed season with no live
 * High — ≥3 seasons AND corner_diff stdev ≤ 0.8
 * Medium — otherwise
 */
export function cornersSeedConfidence(
  blend: CornersRecencyBlend | null,
  liveMatches: number
): CornersSeedConfidence {
  if (!blend) return "low";
  if (blend.seasonCount < 2) return "low";
  if (liveMatches === 0 && blend.seasonCount === 1) return "low";
  if (blend.seasonCount >= 3 && blend.cornerDiffStdev <= DIFF_STDEV_STABLE) return "high";
  return "medium";
}

export function listCornersSeedClubs(league?: string | null): CornersBaselineRow[] {
  if (!league) return [...RAW_ROWS];
  const lk = leagueKey(league);
  return RAW_ROWS.filter((r) => leagueKey(r.league) === lk);
}

export function listCornersSeedSeasons(): string[] {
  return [...SEASON_ORDER].reverse();
}
