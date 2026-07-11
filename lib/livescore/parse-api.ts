import type { MatchLineups, MatchSideLineup } from "@/lib/prediction-log/types";
import type { LivescoreScrapeResult, LivescoreSideStats } from "./types";

/** Goal incident type on Livescore incidents feed. */
const INCIDENT_GOAL = 36;

interface StatBlock {
  Tnb?: number;
  Fls?: number;
  Ths?: number;
  Ofs?: number;
  Cos?: number;
  Shon?: number;
  Shof?: number;
  Shbl?: number;
  Pss?: number;
  Ycs?: number;
  Rcs?: number;
}

interface PlayerRow {
  Fn?: string;
  Ln?: string;
  Snm?: string;
  Pn?: string;
  Fp?: string;
}

interface LineupTeam {
  Tnb?: number;
  Ps?: PlayerRow[];
  Fo?: string | number;
}

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}

function playerName(p: PlayerRow): string {
  if (p.Pn?.trim()) return p.Pn.trim();
  if (p.Snm?.trim()) return p.Snm.trim();
  const parts = [p.Fn, p.Ln].filter((x) => x && String(x).trim());
  return parts.join(" ").trim() || "Unknown";
}

function sideFromStat(block: StatBlock | undefined): LivescoreSideStats {
  if (!block) return {};
  const shon = num(block.Shon);
  const shof = num(block.Shof);
  const shbl = num(block.Shbl);
  let totalShots: number | undefined;
  if (shon != null || shof != null || shbl != null) {
    totalShots = (shon ?? 0) + (shof ?? 0) + (shbl ?? 0);
  }
  return {
    possession: num(block.Pss),
    shotsOnTarget: shon,
    totalShots,
    corners: num(block.Cos),
    fouls: num(block.Fls),
    yellowCards: num(block.Ycs),
    redCards: num(block.Rcs),
    throwIns: num(block.Ths),
    offsides: num(block.Ofs),
  };
}

function lineupSide(
  players: PlayerRow[] | undefined,
  formationRaw?: string | number
): MatchSideLineup {
  const list = players ?? [];
  const starting = list.filter((p) => !!p.Fp).map(playerName);
  const substitutes = list.filter((p) => !p.Fp).map(playerName);
  const formation =
    formationRaw != null && String(formationRaw).trim()
      ? String(formationRaw).trim()
      : undefined;
  return formation ? { starting, substitutes, formation } : { starting, substitutes };
}

function flattenIncidents(incs: unknown): Array<{ Min?: number; IT?: number; Nm?: number }> {
  const out: Array<{ Min?: number; IT?: number; Nm?: number }> = [];
  if (!incs || typeof incs !== "object") return out;

  const walk = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === "object") {
      const o = node as Record<string, unknown>;
      if (typeof o.IT === "number" || typeof o.Min === "number") {
        out.push({
          Min: typeof o.Min === "number" ? o.Min : undefined,
          IT: typeof o.IT === "number" ? o.IT : undefined,
          Nm: typeof o.Nm === "number" ? o.Nm : undefined,
        });
      }
      for (const value of Object.values(o)) {
        if (value && typeof value === "object") walk(value);
      }
    }
  };

  walk(incs);
  return out;
}

export function parseLineupsPayload(raw: unknown): MatchLineups | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const lu = (raw as { Lu?: LineupTeam[] }).Lu;
  if (!Array.isArray(lu) || !lu.length) return undefined;

  const homeBlock = lu.find((t) => t.Tnb === 1) ?? lu[0];
  const awayBlock = lu.find((t) => t.Tnb === 2) ?? lu[1];
  const home = lineupSide(homeBlock?.Ps, homeBlock?.Fo);
  const away = lineupSide(awayBlock?.Ps, awayBlock?.Fo);
  if (!home.starting.length && !away.starting.length) return undefined;
  return { home, away };
}

export function parseStatisticsPayload(raw: unknown): {
  home: LivescoreSideStats;
  away: LivescoreSideStats;
} {
  const empty = { home: {} as LivescoreSideStats, away: {} as LivescoreSideStats };
  if (!raw || typeof raw !== "object") return empty;
  const stats = (raw as { Stat?: StatBlock[] }).Stat;
  if (!Array.isArray(stats)) return empty;
  const home = sideFromStat(stats.find((s) => s.Tnb === 1) ?? stats[0]);
  const away = sideFromStat(stats.find((s) => s.Tnb === 2) ?? stats[1]);
  return { home, away };
}

export function parseIncidentsMeta(raw: unknown): {
  goalInFirst10?: boolean;
  firstGoalSide?: "home" | "away" | "none";
} {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as { Incs?: unknown };
  const flat = flattenIncidents(obj.Incs);
  const goals = flat
    .filter((i) => i.IT === INCIDENT_GOAL && i.Min != null)
    .sort((a, b) => (a.Min ?? 99) - (b.Min ?? 99));

  if (!goals.length) {
    return { goalInFirst10: false, firstGoalSide: "none" };
  }

  const first = goals[0];
  const firstGoalSide: "home" | "away" | "none" =
    first.Nm === 1 ? "home" : first.Nm === 2 ? "away" : "none";
  const goalInFirst10 = goals.some((g) => (g.Min ?? 99) <= 10);
  return { goalInFirst10, firstGoalSide };
}

export function parseScoreboardPayload(raw: unknown): {
  eventId?: string;
  homeTeam?: string;
  awayTeam?: string;
  status?: string;
  competition?: string;
  matchDate?: string;
  homeGoals?: number;
  awayGoals?: number;
  homeHt?: number;
  awayHt?: number;
} {
  if (!raw || typeof raw !== "object") return {};
  const s = raw as Record<string, unknown>;
  const t1 = s.T1 as Array<{ Nm?: string }> | undefined;
  const t2 = s.T2 as Array<{ Nm?: string }> | undefined;
  const stg = s.Stg as { Snm?: string; CompN?: string } | undefined;
  const esd = s.Esd != null ? String(s.Esd) : "";
  const matchDate = esd.length >= 8 ? esd.slice(0, 8) : undefined;

  return {
    eventId: s.Eid != null ? String(s.Eid) : undefined,
    homeTeam: t1?.[0]?.Nm,
    awayTeam: t2?.[0]?.Nm,
    status: typeof s.Eps === "string" ? s.Eps : undefined,
    competition: stg?.CompN || stg?.Snm,
    matchDate,
    homeGoals: num(s.Tr1),
    awayGoals: num(s.Tr2),
    homeHt: num(s.Trh1),
    awayHt: num(s.Trh2),
  };
}

export function assembleScrapeResult(input: {
  eventId: string;
  url: string;
  scoreboard?: unknown;
  statistics?: unknown;
  lineups?: unknown;
  incidents?: unknown;
}): LivescoreScrapeResult {
  const board = parseScoreboardPayload(input.scoreboard);
  const stats = parseStatisticsPayload(input.statistics);
  const lineups = parseLineupsPayload(input.lineups);
  const meta = parseIncidentsMeta(input.incidents);

  const home: LivescoreSideStats = {
    ...stats.home,
    goals: board.homeGoals,
    firstHalfGoals: board.homeHt,
  };
  const away: LivescoreSideStats = {
    ...stats.away,
    goals: board.awayGoals,
    firstHalfGoals: board.awayHt,
  };

  return {
    eventId: board.eventId ?? input.eventId,
    url: input.url,
    homeTeam: board.homeTeam ?? "",
    awayTeam: board.awayTeam ?? "",
    competition: board.competition,
    matchDate: board.matchDate,
    status: board.status,
    home,
    away,
    goalInFirst10: meta.goalInFirst10,
    firstGoalSide: meta.firstGoalSide,
    lineups,
    scrapedAt: new Date().toISOString(),
  };
}
