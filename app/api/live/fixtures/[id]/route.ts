import { NextResponse } from "next/server";
import {
  fetchStatsApiMatch,
  isStatsApiConfigured,
} from "@/lib/stats-api";
import { getDb } from "@/lib/db";
import { liveLeagues } from "@/lib/db/schema";
import { enrichFixturesWithBeSoccer } from "@/lib/live/enrich-besoccer";
import { mergeLiveSources } from "@/lib/live/merge-besoccer";
import { normalizeEvents, normalizeFixture } from "@/lib/live/normalize";
import { apiSportsLiveProvider } from "@/lib/live/provider";
import {
  getEventsForFixture,
  getFixtureById,
  replaceEventsForFixture,
  upsertFixtures,
} from "@/lib/live/store";
import type { LiveFixtureDto, LiveSourceConflictDto } from "@/lib/live/types";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 30;

function parseConflicts(raw: string | null | undefined): LiveSourceConflictDto[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is LiveSourceConflictDto =>
        !!c &&
        typeof c === "object" &&
        typeof (c as LiveSourceConflictDto).field === "string"
    );
  } catch {
    return [];
  }
}

function toDto(
  fixture: NonNullable<Awaited<ReturnType<typeof getFixtureById>>>,
  leagueName: string | null,
  leagueLogoUrl: string | null
): LiveFixtureDto {
  return {
    fixtureId: fixture.fixtureId,
    leagueId: fixture.leagueId,
    season: fixture.season,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    homeId: fixture.homeId,
    awayId: fixture.awayId,
    kickoffUtc: fixture.kickoffUtc.toISOString(),
    venue: fixture.venue,
    status: fixture.status,
    statusMinute: fixture.statusMinute,
    homeGoals: fixture.homeGoals,
    awayGoals: fixture.awayGoals,
    besoccerMatchId: fixture.besoccerMatchId ?? null,
    homeCorners: fixture.homeCorners ?? null,
    awayCorners: fixture.awayCorners ?? null,
    homeShots: fixture.homeShots ?? null,
    awayShots: fixture.awayShots ?? null,
    homePossession: fixture.homePossession ?? null,
    awayPossession: fixture.awayPossession ?? null,
    sourceConflicts: parseConflicts(fixture.sourceConflicts),
    lastSyncedUtc: fixture.lastSyncedUtc.toISOString(),
    leagueName,
    leagueLogoUrl,
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idRaw } = await context.params;
    const fixtureId = Number(idRaw);
    if (!Number.isFinite(fixtureId)) {
      return NextResponse.json({ error: "Invalid fixture id" }, { status: 400 });
    }

    let fixture = await getFixtureById(fixtureId);
    if (!fixture) {
      return NextResponse.json({ error: "Fixture not found" }, { status: 404 });
    }

    if (isStatsApiConfigured() && fixture.besoccerMatchId != null) {
      try {
        const af = await apiSportsLiveProvider.fetchById(fixtureId);
        const secondary = await fetchStatsApiMatch(fixture.besoccerMatchId);
        if (af) {
          const merged = mergeLiveSources(
            af,
            secondary,
            fixture.besoccerMatchId
          );
          const row = normalizeFixture(
            merged.fixture,
            new Date(),
            merged.enrichment
          );
          if (row) {
            await upsertFixtures([row]);
            fixture = (await getFixtureById(fixtureId)) ?? fixture;
          }
        }
      } catch {
        // Keep cached row
      }
    } else if (isStatsApiConfigured() && fixture.besoccerMatchId == null) {
      try {
        const af = await apiSportsLiveProvider.fetchById(fixtureId);
        if (af) {
          const { fixtures, enrichments } = await enrichFixturesWithBeSoccer([
            af,
          ]);
          const mergedFx = fixtures[0];
          if (mergedFx) {
            const row = normalizeFixture(
              mergedFx,
              new Date(),
              enrichments.get(fixtureId) ?? null
            );
            if (row) {
              await upsertFixtures([row]);
              fixture = (await getFixtureById(fixtureId)) ?? fixture;
            }
          }
        }
      } catch {
        // Keep cached
      }
    }

    let events = await getEventsForFixture(fixtureId);
    if (!events.length) {
      try {
        const raw = await apiSportsLiveProvider.fetchEvents(fixtureId);
        const normalized = normalizeEvents(fixtureId, raw);
        if (normalized.length) {
          await replaceEventsForFixture(fixtureId, normalized);
          events = await getEventsForFixture(fixtureId);
        }
      } catch {
        // Keep empty events
      }
    }

    const db = await getDb();
    const [league] = await db
      .select()
      .from(liveLeagues)
      .where(eq(liveLeagues.leagueId, fixture.leagueId))
      .limit(1);

    return NextResponse.json({
      ok: true,
      fixture: toDto(fixture, league?.name ?? null, league?.logoUrl ?? null),
      events: events.map((e) => ({
        id: e.id,
        fixtureId: e.fixtureId,
        minute: e.minute,
        type: e.type,
        team: e.team,
        player: e.player,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load fixture";
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }
}
