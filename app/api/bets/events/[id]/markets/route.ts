import { NextResponse } from "next/server";
import {
  ensureManualSkeletonMarkets,
  getBetEventById,
  listMarketsForEvent,
} from "@/lib/bets/store";
import { fetchAndCacheOddsForFixture } from "@/lib/bets/odds-fetch";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GET markets for a bet_event; soft-refreshes odds when ?refresh=1. */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const betEventId = Number.parseInt(id, 10);
    if (!Number.isFinite(betEventId)) {
      return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }

    const event = await getBetEventById(betEventId);
    if (!event) {
      return NextResponse.json({ ok: false, error: "Event not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    const refresh = url.searchParams.get("refresh") === "1";
    let warning: string | undefined;
    if (refresh) {
      const odds = await fetchAndCacheOddsForFixture(event.apiFixtureId);
      warning = odds.warning;
    } else {
      await ensureManualSkeletonMarkets(event.id);
    }

    const markets = await listMarketsForEvent(event.id);
    return NextResponse.json({
      ok: true,
      event: {
        betEventId: event.id,
        apiFixtureId: event.apiFixtureId,
        leagueId: event.leagueId,
        home: event.home,
        away: event.away,
        kickoffUtc: event.kickoffUtc.toISOString(),
        status: event.status,
        minute: event.minute,
        homeScore: event.homeScore,
        awayScore: event.awayScore,
      },
      markets: markets.map((m) => ({
        id: m.id,
        betEventId: m.betEventId,
        marketType: m.marketType,
        selectionLabel: m.selectionLabel,
        odd: m.odd,
        source: m.source,
      })),
      warning,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
