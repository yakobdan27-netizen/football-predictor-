import { NextResponse } from "next/server";
import { loadBetGames } from "@/lib/bets/load-games";
import { ensureBetSettlementRegistered } from "@/lib/bets/register-settlement";
import { LIVE_SYNC_LEAGUES } from "@/lib/live/constants";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  league?: string;
  tab?: "pre" | "live";
};

/**
 * POST /api/bets/load
 * On-demand: prefer live_*, else AF next/live → upsert bet_events.
 */
export async function POST(request: Request) {
  ensureBetSettlementRegistered();
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const tab = body.tab === "live" ? "live" : "pre";
    const league = (body.league ?? "Premier League").trim();
    if (
      !LIVE_SYNC_LEAGUES.includes(
        league as (typeof LIVE_SYNC_LEAGUES)[number]
      )
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: `League must be one of: ${LIVE_SYNC_LEAGUES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const result = await loadBetGames({ league, tab });
    return NextResponse.json(result, {
      status: result.ok ? 200 : 503,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Load games failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
