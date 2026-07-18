/**
 * Static multi-season half-goals baselines (cold-start when HT samples are thin).
 * Source: data/half-goals-baselines.json — advisory only; never blocks picks.
 */
import { standardizeTeamName } from "@/lib/data/team-names";
import baselinesJson from "@/data/half-goals-baselines.json";

export const HALF_BASELINE_SAMPLE_THRESHOLD = 6;

export interface HalfGoalsBaselineRow {
  clubName: string;
  league: string;
  season: string;
  avgGoals: number;
  avg1h: number;
  avg2h: number;
  pct1hGreater: number;
  pctEqual: number;
  pct2hGreater: number;
  matchesAnalyzed: number;
  partial?: boolean;
}

export interface LeagueHalfBaseline {
  league: string;
  season: string;
  avg1h: number;
  avg2h: number;
  avgGoals: number;
  clubCount: number;
  sourceLabel: string;
}

const SEASON_ORDER = ["2021/22", "2022/23", "2023/24", "2024/25", "2025/26"] as const;
const SEASON_WEIGHT: Record<string, number> = {
  "2021/22": 1,
  "2022/23": 2,
  "2023/24": 3,
  "2024/25": 4,
  "2025/26": 5,
};

export interface ScoringRecencyBlend {
  clubName: string;
  league: string;
  seasonCount: number;
  avgGoals: number;
  avg1h: number;
  avg2h: number;
  /** Effective seed match weight for live blend. */
  seedMatches: number;
  sourceLabel: string;
}

const RAW_ROWS = baselinesJson as HalfGoalsBaselineRow[];

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

/** Infer football season label from an ISO-ish date (Aug–Jul). */
export function seasonFromDate(date: string | undefined | null): string | null {
  if (!date) return null;
  const t = Date.parse(date);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1–12
  if (month >= 8) {
    const next = String(year + 1).slice(-2);
    return `${year}/${next}`;
  }
  const prev = year - 1;
  const yy = String(year).slice(-2);
  return `${prev}/${yy}`;
}

const byClubLeague = new Map<string, HalfGoalsBaselineRow[]>();
const byLeagueSeason = new Map<string, HalfGoalsBaselineRow[]>();

for (const row of RAW_ROWS) {
  const ck = `${clubKey(row.clubName)}|${leagueKey(row.league)}`;
  const list = byClubLeague.get(ck) ?? [];
  list.push(row);
  byClubLeague.set(ck, list);

  const lk = `${leagueKey(row.league)}|${row.season}`;
  const leagueList = byLeagueSeason.get(lk) ?? [];
  leagueList.push(row);
  byLeagueSeason.set(lk, leagueList);
}

for (const list of byClubLeague.values()) {
  list.sort((a, b) => seasonRank(a.season) - seasonRank(b.season));
}

export function allHalfGoalsBaselines(): readonly HalfGoalsBaselineRow[] {
  return RAW_ROWS;
}

export function formatBaselineSource(row: Pick<HalfGoalsBaselineRow, "clubName" | "season">): string {
  return `baseline: ${standardizeTeamName(row.clubName)} ${row.season}`;
}

export function clubScoringSeasonRows(
  clubName: string,
  league: string
): HalfGoalsBaselineRow[] {
  return byClubLeague.get(`${clubKey(clubName)}|${leagueKey(league)}`) ?? [];
}

export function lookupClubHalfBaseline(
  clubName: string,
  league: string,
  season?: string | null
): HalfGoalsBaselineRow | null {
  const list = byClubLeague.get(`${clubKey(clubName)}|${leagueKey(league)}`);
  if (!list || list.length === 0) {
    // League mismatch: try any league for this club name.
    const keySuffix = clubKey(clubName);
    for (const [k, rows] of byClubLeague) {
      if (!k.startsWith(`${keySuffix}|`)) continue;
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

/** Recency-weighted mean of scoring half rates (weights 1…5 for 2021/22…2025/26). */
export function lookupClubScoringRecencyBlend(
  clubName: string,
  league: string
): ScoringRecencyBlend | null {
  let rows = clubScoringSeasonRows(clubName, league);
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
  let avgG = 0;
  let avg1 = 0;
  let avg2 = 0;
  let matchW = 0;
  for (const r of rows) {
    const w = SEASON_WEIGHT[r.season] ?? 1;
    wSum += w;
    avgG += r.avgGoals * w;
    avg1 += r.avg1h * w;
    avg2 += r.avg2h * w;
    matchW += r.matchesAnalyzed * w;
  }
  const stdName = standardizeTeamName(rows[0]!.clubName);
  return {
    clubName: stdName,
    league: rows[0]!.league,
    seasonCount: rows.length,
    avgGoals: avgG / wSum,
    avg1h: avg1 / wSum,
    avg2h: avg2 / wSum,
    seedMatches: matchW / wSum,
    sourceLabel: `seed: ${stdName} (${rows.length} seasons)`,
  };
}

/** League mean of per-team AF proxies (match half avg / 2), recency-weighted across seasons. */
export function lookupLeagueAfBaselines(league: string): { lgAf1: number; lgAf2: number } | null {
  const lk = leagueKey(league);
  let wSum = 0;
  let s1 = 0;
  let s2 = 0;
  for (const [key, rows] of byLeagueSeason) {
    if (!key.startsWith(`${lk}|`)) continue;
    const season = key.slice(lk.length + 1);
    const w = SEASON_WEIGHT[season] ?? 1;
    const avg1h = rows.reduce((a, r) => a + r.avg1h, 0) / rows.length;
    const avg2h = rows.reduce((a, r) => a + r.avg2h, 0) / rows.length;
    wSum += w;
    s1 += (avg1h / 2) * w;
    s2 += (avg2h / 2) * w;
  }
  if (wSum <= 0) {
    const fb = lookupLeagueHalfBaseline(league);
    if (!fb) return null;
    return { lgAf1: fb.avg1h / 2, lgAf2: fb.avg2h / 2 };
  }
  return { lgAf1: s1 / wSum, lgAf2: s2 / wSum };
}

export function lookupLeagueHalfBaseline(
  league: string,
  season?: string | null
): LeagueHalfBaseline | null {
  const seasonsToTry: string[] = [];
  if (season) seasonsToTry.push(season);
  for (let i = SEASON_ORDER.length - 1; i >= 0; i--) {
    const s = SEASON_ORDER[i]!;
    if (!seasonsToTry.includes(s)) seasonsToTry.push(s);
  }

  for (const s of seasonsToTry) {
    const rows = byLeagueSeason.get(`${leagueKey(league)}|${s}`);
    if (!rows || rows.length === 0) continue;
    const avg1h = rows.reduce((a, r) => a + r.avg1h, 0) / rows.length;
    const avg2h = rows.reduce((a, r) => a + r.avg2h, 0) / rows.length;
    const avgGoals = rows.reduce((a, r) => a + r.avgGoals, 0) / rows.length;
    return {
      league,
      season: s,
      avg1h,
      avg2h,
      avgGoals,
      clubCount: rows.length,
      sourceLabel: `baseline: ${league} ${s}`,
    };
  }
  return null;
}

/** Derived league fallbacks for Half Comparison (Bundesliga kept hard-coded elsewhere). */
export function builtInLeagueHalfFallbacks(): Record<string, { avg1h: number; avg2h: number }> {
  const out: Record<string, { avg1h: number; avg2h: number }> = {};
  for (const league of ["Premier League", "La Liga", "Serie A", "Ligue 1"]) {
    const hit = lookupLeagueHalfBaseline(league, "2024/25") ?? lookupLeagueHalfBaseline(league);
    if (hit) out[league] = { avg1h: hit.avg1h, avg2h: hit.avg2h };
  }
  return out;
}
