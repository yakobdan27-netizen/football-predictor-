import {
  emptyMergedMatchStats,
  type MergedMatchStats,
  type StatsApiMatch,
} from "./types";

function asIntOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function asFloatOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function asStringOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

type SidePair = { home?: unknown; away?: unknown };

function sideAllInt(
  block: unknown
): { home: number | null; away: number | null } {
  if (!block || typeof block !== "object") {
    return { home: null, away: null };
  }
  const b = block as { all?: SidePair; home?: unknown; away?: unknown };
  const all = b.all ?? b;
  return {
    home: asIntOrNull((all as SidePair).home),
    away: asIntOrNull((all as SidePair).away),
  };
}

function sideAllFloat(
  block: unknown
): { home: number | null; away: number | null } {
  if (!block || typeof block !== "object") {
    return { home: null, away: null };
  }
  const b = block as { all?: SidePair; home?: unknown; away?: unknown };
  const all = b.all ?? b;
  return {
    home: asFloatOrNull((all as SidePair).home),
    away: asFloatOrNull((all as SidePair).away),
  };
}

function pickStatInt(
  overviewOrStats: Record<string, unknown> | null | undefined,
  key: string
): { home: number | null; away: number | null } {
  if (!overviewOrStats) return { home: null, away: null };
  return sideAllInt(overviewOrStats[key]);
}

function pickStatFloat(
  overviewOrStats: Record<string, unknown> | null | undefined,
  key: string
): { home: number | null; away: number | null } {
  if (!overviewOrStats) return { home: null, away: null };
  return sideAllFloat(overviewOrStats[key]);
}

function fillFromOverview(
  target: MergedMatchStats,
  overview: Record<string, unknown>
): void {
  const takeInt = (
    homeKey: keyof MergedMatchStats,
    awayKey: keyof MergedMatchStats,
    apiKey: string
  ) => {
    const pair = pickStatInt(overview, apiKey);
    if (target[homeKey] == null) (target[homeKey] as number | null) = pair.home;
    if (target[awayKey] == null) (target[awayKey] as number | null) = pair.away;
  };
  const takeFloat = (
    homeKey: keyof MergedMatchStats,
    awayKey: keyof MergedMatchStats,
    apiKey: string
  ) => {
    const pair = pickStatFloat(overview, apiKey);
    if (target[homeKey] == null) (target[homeKey] as number | null) = pair.home;
    if (target[awayKey] == null) (target[awayKey] as number | null) = pair.away;
  };

  takeInt("homePossession", "awayPossession", "ball_possession");
  takeInt("homeShots", "awayShots", "total_shots");
  takeInt("homeCorners", "awayCorners", "corner_kicks");
  takeInt("homeShotsOnTarget", "awayShotsOnTarget", "shots_on_target");
  takeFloat("homeXg", "awayXg", "expected_goals");
  takeInt("homeBigChances", "awayBigChances", "big_chances");
  takeInt("homeGkSaves", "awayGkSaves", "goalkeeper_saves");
  takeInt("homeFouls", "awayFouls", "fouls");
  takeInt("homeYellowCards", "awayYellowCards", "yellow_cards");
  takeInt("homeRedCards", "awayRedCards", "red_cards");
  takeInt("homePasses", "awayPasses", "passes");
  takeInt("homeAccuratePasses", "awayAccuratePasses", "accurate_passes");
  takeInt("homeTackles", "awayTackles", "tackles");
  takeInt("homeFreeKicks", "awayFreeKicks", "free_kicks");
}

export function parseStatsApiMatchList(
  payload: unknown
): import("./types").StatsApiDayMatch[] {
  const root = payload as { data?: unknown };
  const rows = Array.isArray(root?.data)
    ? root.data
    : Array.isArray(payload)
      ? payload
      : [];
  const out: import("./types").StatsApiDayMatch[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const m = row as Record<string, unknown>;
    const id = asStringOrNull(m.id);
    if (!id) continue;
    const home =
      m.home_team && typeof m.home_team === "object"
        ? asStringOrNull((m.home_team as { name?: unknown }).name)
        : null;
    const away =
      m.away_team && typeof m.away_team === "object"
        ? asStringOrNull((m.away_team as { name?: unknown }).name)
        : null;
    if (!home || !away) continue;
    const score =
      m.score && typeof m.score === "object"
        ? (m.score as Record<string, unknown>)
        : null;
    const date = asStringOrNull(m.utc_date);
    const year = date ? asIntOrNull(date.slice(0, 4)) : null;
    out.push({
      id,
      year,
      homeTeam: home,
      awayTeam: away,
      date,
      homeGoals: asIntOrNull(score?.home),
      awayGoals: asIntOrNull(score?.away),
      status: asStringOrNull(m.status),
    });
  }
  return out;
}

/**
 * Build normalized match from detail + `/stats` or `/live-stats` payload.
 */
export function parseStatsApiMatchStats(opts: {
  matchId: string;
  detail?: unknown;
  statsPayload?: unknown;
  liveStatsPayload?: unknown;
}): StatsApiMatch | null {
  const { matchId, detail, statsPayload, liveStatsPayload } = opts;

  let homeTeam = "";
  let awayTeam = "";
  let homeGoals: number | null = null;
  let awayGoals: number | null = null;
  let status: string | null = null;
  let minute: number | null = null;
  let date: string | null = null;
  let year: number | null = null;

  const detailRoot =
    detail && typeof detail === "object" && "data" in (detail as object)
      ? (detail as { data: Record<string, unknown> }).data
      : detail && typeof detail === "object"
        ? (detail as Record<string, unknown>)
        : null;

  if (detailRoot) {
    homeTeam =
      detailRoot.home_team && typeof detailRoot.home_team === "object"
        ? asStringOrNull((detailRoot.home_team as { name?: unknown }).name) ??
          ""
        : "";
    awayTeam =
      detailRoot.away_team && typeof detailRoot.away_team === "object"
        ? asStringOrNull((detailRoot.away_team as { name?: unknown }).name) ??
          ""
        : "";
    const score =
      detailRoot.score && typeof detailRoot.score === "object"
        ? (detailRoot.score as Record<string, unknown>)
        : null;
    homeGoals = asIntOrNull(score?.home);
    awayGoals = asIntOrNull(score?.away);
    status = asStringOrNull(detailRoot.status);
    date = asStringOrNull(detailRoot.utc_date);
    year = date ? asIntOrNull(date.slice(0, 4)) : null;
  }

  const stats = emptyMergedMatchStats();
  let rawJson: string | null = null;

  const statsRoot =
    statsPayload && typeof statsPayload === "object" && "data" in (statsPayload as object)
      ? (statsPayload as { data: Record<string, unknown> }).data
      : null;
  if (statsRoot) {
    try {
      rawJson = JSON.stringify(statsRoot).slice(0, 100_000);
    } catch {
      rawJson = null;
    }
    const overview =
      statsRoot.overview && typeof statsRoot.overview === "object"
        ? (statsRoot.overview as Record<string, unknown>)
        : statsRoot;
    fillFromOverview(stats, overview);
  }

  const liveRoot =
    liveStatsPayload &&
    typeof liveStatsPayload === "object" &&
    "data" in (liveStatsPayload as object)
      ? (liveStatsPayload as { data: Record<string, unknown> }).data
      : null;
  if (liveRoot) {
    if (!rawJson) {
      try {
        rawJson = JSON.stringify(liveRoot).slice(0, 100_000);
      } catch {
        rawJson = null;
      }
    }
    const meta =
      liveRoot.meta && typeof liveRoot.meta === "object"
        ? (liveRoot.meta as Record<string, unknown>)
        : null;
    if (meta) {
      if (homeGoals == null) homeGoals = asIntOrNull(meta.home_goals);
      if (awayGoals == null) awayGoals = asIntOrNull(meta.away_goals);
      minute = asIntOrNull(meta.elapsed_minutes);
      status = asStringOrNull(meta.match_status) ?? status;
    }
    const liveStats =
      liveRoot.stats && typeof liveRoot.stats === "object"
        ? (liveRoot.stats as Record<string, unknown>)
        : null;
    if (liveStats) {
      fillFromOverview(stats, liveStats);
    }
  }

  if (!matchId) return null;

  stats.rawJson = rawJson;

  return {
    id: matchId,
    year,
    homeTeam,
    awayTeam,
    homeGoals,
    awayGoals,
    status,
    minute,
    date,
    ...stats,
    raw: { detail, statsPayload, liveStatsPayload },
  };
}
