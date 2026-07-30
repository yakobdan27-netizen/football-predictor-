import { NextResponse } from "next/server";
import { warmTeamHalfProfiles } from "@/lib/prediction-log/two-h-heavy/fetch-profiles";
import type { VenueSide } from "@/lib/prediction-log/two-h-heavy/types";

/**
 * POST /api/two-h-heavy/refresh
 * Best-effort warm of team half profiles from API-Football into KV.
 * Body: { requests: [{ team, league, venue }] } or { matches: [{ homeTeam, awayTeam, league }] }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      requests?: { team: string; league: string; venue: VenueSide }[];
      matches?: { homeTeam: string; awayTeam: string; league: string }[];
      maxCalls?: number;
    };

    const requests: { team: string; league: string; venue: VenueSide }[] = [
      ...(body.requests ?? []),
    ];

    for (const m of body.matches ?? []) {
      if (!m.homeTeam || !m.awayTeam || !m.league) continue;
      requests.push({ team: m.homeTeam, league: m.league, venue: "home" });
      requests.push({ team: m.awayTeam, league: m.league, venue: "away" });
    }

    if (requests.length === 0) {
      return NextResponse.json({ ok: true, refreshed: 0, failed: 0, note: "no requests" });
    }

    const result = await warmTeamHalfProfiles(requests, {
      maxCalls: body.maxCalls ?? 16,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Refresh failed";
    // Soft-fail: ranking still works offline from db/prior
    return NextResponse.json({ ok: false, error: msg, refreshed: 0, failed: 0 }, { status: 200 });
  }
}
