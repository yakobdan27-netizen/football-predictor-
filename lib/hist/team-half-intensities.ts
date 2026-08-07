/**
 * Venue-split 1H/2H scored/conceded from hist_fixtures (+ hist_goals fallback).
 * Models may read; writers stay under lib/hist/.
 */
import { and, desc, eq, gte, isNotNull, or, sql } from "drizzle-orm";
import { standardizeTeamName } from "@/lib/data/team-names";
import { getDb } from "@/lib/db";
import { histFixtures, histGoals } from "@/lib/db/schema";
import { apiLeagueId } from "@/lib/football-api/leagues";
import { MIN_MATCHES } from "@/lib/prediction-log/two-h-heavy/config";
import type {
  CachedTeamHalfProfile,
  TeamHalfProfile,
  VenueSide,
} from "@/lib/prediction-log/two-h-heavy/types";
import { currentHistSeason, histSeasonWeight, histWindowMinSeason } from "./seasons";

function teamKey(name: string): string {
  return standardizeTeamName(name).trim().toLowerCase();
}

async function htFromGoals(
  fixtureId: number,
  homeId: number | null,
  awayId: number | null
): Promise<{ htHome: number; htAway: number } | null> {
  if (homeId == null || awayId == null) return null;
  const db = await getDb();
  const rows = await db
    .select({
      teamId: histGoals.teamId,
      half: histGoals.half,
    })
    .from(histGoals)
    .where(
      and(eq(histGoals.fixtureId, fixtureId), eq(histGoals.half, "1H"))
    );
  if (!rows.length) return null;
  let htHome = 0;
  let htAway = 0;
  for (const r of rows) {
    if (r.teamId === homeId) htHome += 1;
    else if (r.teamId === awayId) htAway += 1;
  }
  return { htHome, htAway };
}

export async function computeTeamHalfFromHist(
  team: string,
  venue: VenueSide,
  league: string,
  opts?: { limit?: number; minMatches?: number }
): Promise<TeamHalfProfile | null> {
  const leagueId = apiLeagueId(league);
  if (leagueId == null) return null;

  const db = await getDb();
  const key = teamKey(team);
  const limit = opts?.limit ?? 40;
  const minMatches = opts?.minMatches ?? MIN_MATCHES;
  const current = currentHistSeason();
  const minSeason = histWindowMinSeason();

  const rows = await db
    .select({
      fixtureId: histFixtures.fixtureId,
      season: histFixtures.season,
      dateUtc: histFixtures.dateUtc,
      homeTeam: histFixtures.homeTeam,
      awayTeam: histFixtures.awayTeam,
      homeId: histFixtures.homeId,
      awayId: histFixtures.awayId,
      htHome: histFixtures.htHome,
      htAway: histFixtures.htAway,
      ftHome: histFixtures.ftHome,
      ftAway: histFixtures.ftAway,
    })
    .from(histFixtures)
    .where(
      and(
        eq(histFixtures.leagueId, leagueId),
        eq(histFixtures.compType, "league"),
        gte(histFixtures.season, minSeason),
        or(
          eq(histFixtures.homeTeam, standardizeTeamName(team)),
          eq(histFixtures.awayTeam, standardizeTeamName(team)),
          sql`lower(${histFixtures.homeTeam}) = ${key}`,
          sql`lower(${histFixtures.awayTeam}) = ${key}`
        ),
        isNotNull(histFixtures.ftHome),
        isNotNull(histFixtures.ftAway)
      )
    )
    .orderBy(desc(histFixtures.dateUtc))
    .limit(limit * 3);

  type Sample = {
    sc1: number;
    sc2: number;
    conc1: number;
    conc2: number;
    w: number;
    date: string;
  };
  const samples: Sample[] = [];

  for (const row of rows) {
    const isHome = teamKey(row.homeTeam) === key;
    const isAway = teamKey(row.awayTeam) === key;
    if (venue === "home" && !isHome) continue;
    if (venue === "away" && !isAway) continue;

    let htH = row.htHome;
    let htA = row.htAway;
    if (htH == null || htA == null) {
      const derived = await htFromGoals(row.fixtureId, row.homeId, row.awayId);
      if (!derived) continue;
      htH = derived.htHome;
      htA = derived.htAway;
    }
    const ftH = row.ftHome!;
    const ftA = row.ftAway!;
    const w = histSeasonWeight(row.season, current);
    const date =
      row.dateUtc instanceof Date
        ? row.dateUtc.toISOString().slice(0, 10)
        : String(row.dateUtc).slice(0, 10);

    if (isHome) {
      samples.push({
        sc1: htH,
        sc2: Math.max(0, ftH - htH),
        conc1: htA,
        conc2: Math.max(0, ftA - htA),
        w,
        date,
      });
    } else {
      samples.push({
        sc1: htA,
        sc2: Math.max(0, ftA - htA),
        conc1: htH,
        conc2: Math.max(0, ftH - htH),
        w,
        date,
      });
    }
    if (samples.length >= limit) break;
  }

  if (samples.length < minMatches) return null;

  let wSum = 0;
  let sc1 = 0;
  let sc2 = 0;
  let conc1 = 0;
  let conc2 = 0;
  for (const s of samples) {
    wSum += s.w;
    sc1 += s.sc1 * s.w;
    sc2 += s.sc2 * s.w;
    conc1 += s.conc1 * s.w;
    conc2 += s.conc2 * s.w;
  }
  if (wSum <= 0) return null;

  return {
    team: standardizeTeamName(team),
    venue,
    sc_1h: sc1 / wSum,
    sc_2h: sc2 / wSum,
    conc_1h: conc1 / wSum,
    conc_2h: conc2 / wSum,
    n_matches: samples.length,
    last_match_date: samples[0]?.date ?? null,
    source: "hist",
    formation: null,
  };
}

export async function loadHistProfilesForTeams(
  requests: { team: string; league: string; venue: VenueSide }[]
): Promise<Record<string, CachedTeamHalfProfile>> {
  const out: Record<string, CachedTeamHalfProfile> = {};
  const seen = new Set<string>();
  for (const req of requests) {
    const key = `${teamKey(req.team)}|${req.venue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const profile = await computeTeamHalfFromHist(
        req.team,
        req.venue,
        req.league
      );
      if (!profile || profile.n_matches < MIN_MATCHES) continue;
      const leagueId = apiLeagueId(req.league) ?? 0;
      out[key] = {
        teamId: 0,
        teamName: profile.team,
        leagueId,
        venue: req.venue,
        sc_1h: profile.sc_1h,
        sc_2h: profile.sc_2h,
        conc_1h: profile.conc_1h,
        conc_2h: profile.conc_2h,
        n_matches: profile.n_matches,
        last_match_date: profile.last_match_date,
        formation: null,
        updatedAt: new Date().toISOString(),
        source: "hist",
      };
    } catch {
      // ignore per-team failures
    }
  }
  return out;
}

/** Optional league FT goal average when sample ≥ minMatches (11-season window, weighted). */
export async function leagueGoalAverageFromHist(
  league: string,
  opts?: { minMatches?: number }
): Promise<number | null> {
  const leagueId = apiLeagueId(league);
  if (leagueId == null) return null;
  const minMatches = opts?.minMatches ?? MIN_MATCHES;
  const db = await getDb();
  const current = currentHistSeason();
  const minSeason = histWindowMinSeason();
  const rows = await db
    .select({
      season: histFixtures.season,
      ftHome: histFixtures.ftHome,
      ftAway: histFixtures.ftAway,
    })
    .from(histFixtures)
    .where(
      and(
        eq(histFixtures.leagueId, leagueId),
        eq(histFixtures.compType, "league"),
        isNotNull(histFixtures.ftHome),
        isNotNull(histFixtures.ftAway),
        gte(histFixtures.season, minSeason)
      )
    );
  if (rows.length < minMatches) return null;
  let wSum = 0;
  let gSum = 0;
  for (const r of rows) {
    const w = histSeasonWeight(r.season, current);
    wSum += w;
    gSum += (r.ftHome! + r.ftAway!) * w;
  }
  if (wSum <= 0) return null;
  return gSum / wSum;
}
