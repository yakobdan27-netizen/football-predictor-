/**
 * Map API-Football payloads → hist_* row shapes.
 */
import type {
  NewHistFixture,
  NewHistGoal,
  NewHistLineup,
  NewHistStat,
  NewHistTeam,
} from "@/lib/db/schema";
import type { LiveApiEvent, LiveApiFixture } from "@/lib/live/types";
import { histCompType, type HistCompType } from "./seasons";

export type HistCompleteness = "full" | "partial" | "core-only";

const COMPLETENESS_RANK: Record<HistCompleteness, number> = {
  "core-only": 0,
  partial: 1,
  full: 2,
};

export function completenessRank(c: string): number {
  return COMPLETENESS_RANK[c as HistCompleteness] ?? 0;
}

export function richerCompleteness(a: string, b: string): HistCompleteness {
  return completenessRank(a) >= completenessRank(b)
    ? (a as HistCompleteness)
    : (b as HistCompleteness);
}

type AfScoreFixture = LiveApiFixture & {
  score?: {
    halftime?: { home?: number | null; away?: number | null };
    fulltime?: { home?: number | null; away?: number | null };
  };
  league?: LiveApiFixture["league"] & { round?: string | null };
};

type AfEvent = LiveApiEvent & {
  team?: { id?: number | null; name?: string | null };
};

type AfStatItem = { type?: string | null; value?: string | number | null };
type AfStatsRow = {
  team?: { id?: number | null; name?: string | null };
  statistics?: AfStatItem[];
};

type AfLineupRow = {
  team?: { id?: number | null; name?: string | null };
  formation?: string | null;
};

function asIntOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const cleaned = v.replace(/%/g, "").trim();
    const n = Number(cleaned);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

export function halfFromMinute(minute: number | null): "1H" | "2H" {
  if (minute == null || !Number.isFinite(minute)) return "2H";
  return minute <= 45 ? "1H" : "2H";
}

export function mapFixtureCore(
  raw: LiveApiFixture,
  seasonFallback: number,
  completeness: HistCompleteness,
  importedAt: Date = new Date(),
  compTypeOverride?: HistCompType
): NewHistFixture | null {
  const f = raw as AfScoreFixture;
  const fixtureId = f.fixture?.id;
  if (fixtureId == null || !Number.isFinite(fixtureId)) return null;
  const leagueId = f.league?.id;
  if (leagueId == null || !Number.isFinite(leagueId)) return null;
  const homeTeam = f.teams?.home?.name?.trim();
  const awayTeam = f.teams?.away?.name?.trim();
  if (!homeTeam || !awayTeam) return null;
  const kickoff = f.fixture?.date;
  if (!kickoff) return null;
  const dateUtc = new Date(kickoff);
  if (Number.isNaN(dateUtc.getTime())) return null;

  const htHome = asIntOrNull(f.score?.halftime?.home);
  const htAway = asIntOrNull(f.score?.halftime?.away);
  const ftHome =
    asIntOrNull(f.goals?.home) ?? asIntOrNull(f.score?.fulltime?.home);
  const ftAway =
    asIntOrNull(f.goals?.away) ?? asIntOrNull(f.score?.fulltime?.away);

  return {
    fixtureId,
    leagueId,
    season: f.league?.season ?? seasonFallback,
    compType: compTypeOverride ?? histCompType(leagueId),
    round: f.league?.round?.trim() || null,
    dateUtc,
    homeId: asIntOrNull(f.teams.home.id),
    awayId: asIntOrNull(f.teams.away.id),
    homeTeam,
    awayTeam,
    venue: f.fixture.venue?.name?.trim() || null,
    htHome,
    htAway,
    ftHome,
    ftAway,
    status: (f.fixture.status?.short ?? "FT").trim().toUpperCase(),
    dataCompleteness: completeness,
    importedAt,
  };
}

export function mapTeamsFromFixture(
  raw: LiveApiFixture,
  season: number
): NewHistTeam[] {
  const out: NewHistTeam[] = [];
  for (const side of [raw.teams?.home, raw.teams?.away] as const) {
    const id = asIntOrNull(side?.id);
    const name = side?.name?.trim();
    if (id == null || !name) continue;
    out.push({
      teamId: id,
      name,
      logo: side?.logo?.trim() || null,
      country: null,
      firstSeenSeason: season,
    });
  }
  return out;
}

export function mapGoalEvents(
  fixtureId: number,
  events: LiveApiEvent[]
): NewHistGoal[] {
  const out: NewHistGoal[] = [];
  for (const ev of events) {
    const type = (ev.type ?? "").toLowerCase();
    if (type !== "goal") continue;
    const e = ev as AfEvent;
    const minute = asIntOrNull(e.time?.elapsed);
    out.push({
      fixtureId,
      teamId: asIntOrNull(e.team?.id),
      minute,
      extraMinute: asIntOrNull(e.time?.extra),
      half: halfFromMinute(minute),
      player: e.player?.name?.trim() || null,
      type: e.detail?.trim() || e.type?.trim() || "Goal",
    });
  }
  return out;
}

function findStat(stats: AfStatItem[], needle: string): number | null {
  const hit = stats.find((s) =>
    (s.type ?? "").toLowerCase().includes(needle.toLowerCase())
  );
  return asIntOrNull(hit?.value);
}

export function mapStatistics(
  fixtureId: number,
  rows: unknown[]
): NewHistStat[] {
  const out: NewHistStat[] = [];
  for (const row of rows as AfStatsRow[]) {
    const teamId = asIntOrNull(row.team?.id);
    if (teamId == null) continue;
    const stats = row.statistics ?? [];
    out.push({
      fixtureId,
      teamId,
      shots: findStat(stats, "Total Shots") ?? findStat(stats, "Shots"),
      sot: findStat(stats, "Shots on Goal") ?? findStat(stats, "Shots on Target"),
      possession: findStat(stats, "Ball Possession"),
      corners: findStat(stats, "Corner"),
      htCorners:
        findStat(stats, "Corner Kicks 1st Half") ??
        findStat(stats, "1st Half Corners") ??
        null,
      yellow: findStat(stats, "Yellow Cards"),
      red: findStat(stats, "Red Cards"),
      fouls: findStat(stats, "Fouls"),
      offsides: findStat(stats, "Offsides"),
    });
  }
  return out;
}

export function mapLineups(
  fixtureId: number,
  rows: unknown[]
): NewHistLineup[] {
  const out: NewHistLineup[] = [];
  for (const row of rows as AfLineupRow[]) {
    const teamId = asIntOrNull(row.team?.id);
    if (teamId == null) continue;
    out.push({
      fixtureId,
      teamId,
      formation: row.formation?.trim() || null,
    });
  }
  return out;
}

/**
 * full = FT + HT scores + goals enrichment + stats rows present (corners attempted).
 * Corners value may still be NULL (sparse UCL) → still full if stats row exists + HT.
 * No stats → core-only (or partial if goals only).
 */
export function inferCompleteness(opts: {
  hasGoals: boolean;
  hasStats: boolean;
  hasLineups: boolean;
  hasHt?: boolean;
  hasFt?: boolean;
  /** True when at least one stats row has a non-null corners value. */
  hasCornersValue?: boolean;
}): HistCompleteness {
  const hasFt = opts.hasFt !== false;
  const hasHt = opts.hasHt === true;
  if (!hasFt) return "core-only";

  if (opts.hasGoals && opts.hasStats && hasHt) {
    // Stats attempted (corners field may be NULL on sparse seasons)
    return "full";
  }
  if (opts.hasGoals || opts.hasStats || opts.hasLineups || hasHt) {
    return "partial";
  }
  return "core-only";
}
