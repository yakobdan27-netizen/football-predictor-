import { NextResponse } from "next/server";
import {
  NEXT_MATCHES_LEAGUES,
  type NextMatchesLeague,
} from "@/lib/football-api/fetch-upcoming-league";
import { queryRecentMatchCentreResults } from "@/lib/match-centre/recent-results";

export const maxDuration = 30;
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
    const hoursRaw = url.searchParams.get("hours");
    const limitRaw = url.searchParams.get("limit");
    const hours = hoursRaw ? Number(hoursRaw) : 48;
    const limit = limitRaw ? Number(limitRaw) : 20;

    const results = await queryRecentMatchCentreResults({
      league,
      hours: Number.isFinite(hours) ? hours : 48,
      limit: Number.isFinite(limit) ? limit : 20,
    });

    return NextResponse.json({
      ok: true,
      league,
      hours: Number.isFinite(hours) ? hours : 48,
      results,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load recent results";
    return NextResponse.json({ ok: false, error: msg, results: [] }, { status: 500 });
  }
}
