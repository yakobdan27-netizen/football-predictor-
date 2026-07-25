import { NextResponse } from "next/server";
import { normalizeEvents } from "@/lib/live/normalize";
import { apiSportsLiveProvider } from "@/lib/live/provider";
import {
  getEventsForFixture,
  getFixtureById,
  replaceEventsForFixture,
} from "@/lib/live/store";
import { liveLeagues } from "@/lib/db/schema";
import { getDb } from "@/lib/db";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 30;

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

    const fixture = await getFixtureById(fixtureId);
    if (!fixture) {
      return NextResponse.json({ error: "Fixture not found" }, { status: 404 });
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
        // Keep empty events — show — in UI
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
      fixture: {
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
        lastSyncedUtc: fixture.lastSyncedUtc.toISOString(),
        leagueName: league?.name ?? null,
        leagueLogoUrl: league?.logoUrl ?? null,
      },
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
