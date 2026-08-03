/**
 * Persist / load team_half_stats derived from hist_*.
 */
import { and, eq, sql } from "drizzle-orm";
import { standardizeTeamName } from "@/lib/data/team-names";
import { getDb } from "@/lib/db";
import { histFixtures, teamHalfStats } from "@/lib/db/schema";
import { MIN_MATCHES } from "@/lib/prediction-log/two-h-heavy/config";
import type {
  CachedTeamHalfProfile,
  VenueSide,
} from "@/lib/prediction-log/two-h-heavy/types";
import { HIST_BIG5_LEAGUES } from "./seasons";
import { computeTeamHalfFromHist } from "./team-half-intensities";

function teamKey(name: string): string {
  return standardizeTeamName(name).trim().toLowerCase();
}

export type PersistTeamHalfStatsResult = {
  ok: boolean;
  written: number;
  thinData: number;
  teams: number;
};

/** Distinct teams per Big-5 league from hist_fixtures, then upsert half stats. */
export async function persistTeamHalfStatsFromHist(): Promise<PersistTeamHalfStatsResult> {
  const db = await getDb();
  let written = 0;
  let thinData = 0;
  const teamSet = new Set<string>();

  for (const league of HIST_BIG5_LEAGUES) {
    const rows = await db
      .select({
        homeTeam: histFixtures.homeTeam,
        awayTeam: histFixtures.awayTeam,
        homeId: histFixtures.homeId,
        awayId: histFixtures.awayId,
      })
      .from(histFixtures)
      .where(eq(histFixtures.leagueId, league.id));

    const teams = new Map<string, { name: string; teamId: number | null }>();
    for (const r of rows) {
      const hk = teamKey(r.homeTeam);
      const ak = teamKey(r.awayTeam);
      if (!teams.has(hk)) {
        teams.set(hk, {
          name: standardizeTeamName(r.homeTeam),
          teamId: r.homeId,
        });
      }
      if (!teams.has(ak)) {
        teams.set(ak, {
          name: standardizeTeamName(r.awayTeam),
          teamId: r.awayId,
        });
      }
    }

    for (const [, meta] of teams) {
      teamSet.add(`${league.id}|${meta.name}`);
      for (const venue of ["home", "away"] as VenueSide[]) {
        // Allow thin samples to persist with thin_data=1 (minMatches=1).
        const profile = await computeTeamHalfFromHist(
          meta.name,
          venue,
          league.name,
          { minMatches: 1 }
        );
        if (!profile) continue;
        const thin = profile.n_matches < MIN_MATCHES ? 1 : 0;
        if (thin) thinData += 1;
        const now = new Date();
        const existing = await db
          .select({ id: teamHalfStats.id })
          .from(teamHalfStats)
          .where(
            and(
              eq(teamHalfStats.teamName, meta.name),
              eq(teamHalfStats.leagueId, league.id),
              eq(teamHalfStats.venue, venue)
            )
          )
          .limit(1);

        if (existing[0]) {
          await db
            .update(teamHalfStats)
            .set({
              teamId: meta.teamId,
              scored1h: profile.sc_1h,
              scored2h: profile.sc_2h,
              conceded1h: profile.conc_1h,
              conceded2h: profile.conc_2h,
              sampleSize: profile.n_matches,
              thinData: thin,
              lastUpdated: now,
            })
            .where(eq(teamHalfStats.id, existing[0].id));
        } else {
          await db.insert(teamHalfStats).values({
            teamId: meta.teamId,
            teamName: meta.name,
            leagueId: league.id,
            venue,
            scored1h: profile.sc_1h,
            scored2h: profile.sc_2h,
            conceded1h: profile.conc_1h,
            conceded2h: profile.conc_2h,
            sampleSize: profile.n_matches,
            thinData: thin,
            lastUpdated: now,
          });
        }
        written += 1;
      }
    }
  }

  return { ok: true, written, thinData, teams: teamSet.size };
}

export async function loadTeamHalfStatsProfiles(
  requests: { team: string; league: string; venue: VenueSide }[],
  leagueIdByName: (league: string) => number | null
): Promise<Record<string, CachedTeamHalfProfile>> {
  const out: Record<string, CachedTeamHalfProfile> = {};
  const db = await getDb();
  const seen = new Set<string>();

  for (const req of requests) {
    const key = `${teamKey(req.team)}|${req.venue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const leagueId = leagueIdByName(req.league);
    if (leagueId == null) continue;
    const name = standardizeTeamName(req.team);
    const [row] = await db
      .select()
      .from(teamHalfStats)
      .where(
        and(
          eq(teamHalfStats.leagueId, leagueId),
          eq(teamHalfStats.venue, req.venue),
          sql`lower(${teamHalfStats.teamName}) = ${teamKey(name)}`
        )
      )
      .limit(1);
    if (!row || row.sampleSize < MIN_MATCHES) continue;
    out[key] = {
      teamId: row.teamId ?? 0,
      teamName: row.teamName,
      leagueId,
      venue: req.venue,
      sc_1h: row.scored1h,
      sc_2h: row.scored2h,
      conc_1h: row.conceded1h,
      conc_2h: row.conceded2h,
      n_matches: row.sampleSize,
      last_match_date: row.lastUpdated.toISOString().slice(0, 10),
      formation: null,
      updatedAt: row.lastUpdated.toISOString(),
      source: "hist",
    };
  }
  return out;
}
