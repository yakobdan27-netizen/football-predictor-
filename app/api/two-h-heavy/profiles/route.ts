import { NextResponse } from "next/server";
import { readCachedProfilesForTeams } from "@/lib/prediction-log/two-h-heavy/fetch-profiles";
import type { VenueSide } from "@/lib/prediction-log/two-h-heavy/types";

/**
 * GET /api/two-h-heavy/profiles?q=Team|home|League&q=...
 * Read-only KV lookup — never calls API-Football.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const qs = url.searchParams.getAll("q");
    const requests: { team: string; league: string; venue: VenueSide }[] = [];

    for (const raw of qs) {
      const parts = raw.split("|");
      if (parts.length < 3) continue;
      const team = parts[0]?.trim();
      const venue = parts[1]?.trim().toLowerCase();
      const league = parts.slice(2).join("|").trim();
      if (!team || !league || (venue !== "home" && venue !== "away")) continue;
      requests.push({ team, venue, league });
    }

    // Also accept JSON body-style via teams query: teams=Arsenal,home,Premier League;Chelsea,away,Premier League
    const teamsParam = url.searchParams.get("teams");
    if (teamsParam) {
      for (const chunk of teamsParam.split(";")) {
        const [team, venue, ...leagueParts] = chunk.split(",");
        const v = venue?.trim().toLowerCase();
        const league = leagueParts.join(",").trim();
        if (!team?.trim() || !league || (v !== "home" && v !== "away")) continue;
        requests.push({ team: team.trim(), venue: v, league });
      }
    }

    if (requests.length === 0) {
      return NextResponse.json({ profiles: {} });
    }

    const profiles = await readCachedProfilesForTeams(requests);
    return NextResponse.json({ profiles });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load profiles";
    return NextResponse.json({ error: msg, profiles: {} }, { status: 200 });
  }
}
