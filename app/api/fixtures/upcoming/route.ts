import { NextResponse } from "next/server";
import {
  DEFAULT_UPCOMING_NEXT,
  NEXT_MATCHES_LEAGUES,
  fetchUpcomingForLeague,
  type NextMatchesLeague,
} from "@/lib/football-api/fetch-upcoming-league";

export const maxDuration = 60;
export const runtime = "nodejs";

function parseLeague(raw: string | null): NextMatchesLeague | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return (NEXT_MATCHES_LEAGUES as readonly string[]).includes(trimmed)
    ? (trimmed as NextMatchesLeague)
    : null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const league = parseLeague(url.searchParams.get("league"));
    if (!league) {
      return NextResponse.json(
        {
          error: `league must be one of: ${NEXT_MATCHES_LEAGUES.join(", ")}`,
        },
        { status: 400 }
      );
    }
    const nextRaw = url.searchParams.get("next");
    const next = nextRaw ? Number(nextRaw) : DEFAULT_UPCOMING_NEXT;
    const refresh =
      url.searchParams.get("refresh") === "1" ||
      url.searchParams.get("refresh") === "true";

    const result = await fetchUpcomingForLeague({
      league,
      next: Number.isFinite(next) ? next : DEFAULT_UPCOMING_NEXT,
      refresh,
    });

    return NextResponse.json({
      ok: true,
      season: result.season,
      league: result.league,
      leagueId: result.leagueId,
      fixtures: result.fixtures,
      fromCache: result.fromCache,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load upcoming fixtures";
    const status = /API_FOOTBALL_KEY|not configured/i.test(msg) ? 503 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
