import { NextResponse } from "next/server";
import { matchCentreRatesCacheKey } from "@/lib/prediction-log/api-season-blend";
import { preloadMatchCentreHalfRates } from "@/lib/match-centre/team-half-rates";
import type { ClubHalfAttackDefence } from "@/lib/prediction-log/hsh-half-rates";

export const runtime = "nodejs";

/** GET ?teams=Arsenal,Chelsea&league=Premier+League */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const league = url.searchParams.get("league")?.trim() ?? "";
    const teamsRaw = url.searchParams.get("teams")?.trim() ?? "";
    if (!league || !teamsRaw) {
      return NextResponse.json(
        { ok: false, error: "league and teams required" },
        { status: 400 }
      );
    }

    const teams = teamsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (!teams.length) {
      return NextResponse.json(
        { ok: false, error: "teams required" },
        { status: 400 }
      );
    }

    const map = await preloadMatchCentreHalfRates(
      teams.map((team) => ({ team, league }))
    );

    const rates: Record<string, ClubHalfAttackDefence> = {};
    for (const [key, value] of map) {
      rates[key] = value;
    }

    // Also expose standard cache keys for client map lookup
    for (const team of teams) {
      const key = matchCentreRatesCacheKey(team, league);
      const hit = map.get(key);
      if (hit) rates[key] = hit;
    }

    return NextResponse.json({ ok: true, rates });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
