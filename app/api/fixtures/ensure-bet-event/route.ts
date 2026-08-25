import { NextResponse } from "next/server";
import {
  ensureManualSkeletonMarkets,
  upsertBetEventFromLive,
} from "@/lib/bets/store";
import { fetchAndCacheOddsForFixture } from "@/lib/bets/odds-fetch";

export const runtime = "nodejs";
export const maxDuration = 60;

type EnsureBetEventBody = {
  apiFixtureId: number;
  leagueId: number;
  home: string;
  away: string;
  kickoffIso: string;
  status?: string;
  refresh?: boolean;
};

/** Upsert bet_event + skeleton markets so MatchMarketView can load for an upcoming fixture. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as EnsureBetEventBody;
    const apiFixtureId = body.apiFixtureId;
    if (!Number.isFinite(apiFixtureId) || apiFixtureId <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid apiFixtureId" }, { status: 400 });
    }
    if (!body.home?.trim() || !body.away?.trim()) {
      return NextResponse.json({ ok: false, error: "home and away required" }, { status: 400 });
    }
    const kickoff = new Date(body.kickoffIso);
    if (Number.isNaN(kickoff.getTime())) {
      return NextResponse.json({ ok: false, error: "Invalid kickoffIso" }, { status: 400 });
    }

    const event = await upsertBetEventFromLive({
      apiFixtureId,
      leagueId: body.leagueId,
      home: body.home.trim(),
      away: body.away.trim(),
      kickoffUtc: kickoff,
      status: (body.status ?? "NS").trim().toUpperCase(),
      minute: null,
      homeScore: null,
      awayScore: null,
      feedType: "PRE",
    });

    let warning: string | undefined;
    if (body.refresh) {
      const odds = await fetchAndCacheOddsForFixture(apiFixtureId);
      warning = odds.warning;
    } else {
      await ensureManualSkeletonMarkets(event.id);
    }

    return NextResponse.json({
      ok: true,
      betEventId: event.id,
      warning,
      event: {
        betEventId: event.id,
        apiFixtureId: event.apiFixtureId,
        home: event.home,
        away: event.away,
        kickoffUtc: event.kickoffUtc.toISOString(),
        status: event.status,
        minute: event.minute,
        homeScore: event.homeScore,
        awayScore: event.awayScore,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to ensure bet event";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
