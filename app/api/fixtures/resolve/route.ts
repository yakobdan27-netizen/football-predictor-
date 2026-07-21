import { NextResponse } from "next/server";
import { resolveUpcomingFixture } from "@/lib/football-api/resolve-upcoming-fixture";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      homeTeam?: string;
      awayTeam?: string;
      league?: string | null;
    };
    const homeTeam = body.homeTeam?.trim() ?? "";
    const awayTeam = body.awayTeam?.trim() ?? "";
    if (!homeTeam || !awayTeam) {
      return NextResponse.json(
        { error: "homeTeam and awayTeam are required" },
        { status: 400 }
      );
    }
    const result = await resolveUpcomingFixture({
      homeTeam,
      awayTeam,
      league: body.league,
    });
    if (!result.ok) {
      const status =
        result.error.code === "api_error"
          ? 502
          : result.error.code === "team_not_found"
            ? 404
            : 404;
      return NextResponse.json(
        {
          error: result.error.message,
          code: result.error.code,
          suggestions: result.error.suggestions ?? [],
        },
        { status }
      );
    }
    return NextResponse.json({ ok: true, fixture: result.fixture });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fixture resolve failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
