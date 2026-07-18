import { NextResponse } from "next/server";
import { getLeagueMatchupAnalysis } from "@/lib/prediction-log/league-matchup-analysis";
import { buildAllSeedLeagueProfiles } from "@/lib/prediction-log/league-seed-profiles";
import { resolveLeagueId } from "@/lib/prediction-log/league-registry";
import { leagueProfileKey } from "@/lib/prediction-log/season";

/**
 * GET /api/league-analysis?homeTeam=…&awayTeam=…&league=…
 * Reference-only matchup from 2021–26 seed priors.
 * Optional: omit teams to return seed league profile keys.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const homeTeam = searchParams.get("homeTeam")?.trim() ?? "";
    const awayTeam = searchParams.get("awayTeam")?.trim() ?? "";
    const league = searchParams.get("league")?.trim() ?? "Premier League";
    const season = searchParams.get("season")?.trim();

    if (!homeTeam || !awayTeam) {
      const profiles = buildAllSeedLeagueProfiles();
      const leagueId = resolveLeagueId(league);
      const keys = Object.keys(profiles).filter((k) => k.startsWith(`${leagueId}::`));
      const profile =
        season != null
          ? profiles[leagueProfileKey(leagueId, season)] ?? null
          : keys.length
            ? profiles[keys.sort().reverse()[0]!]
            : null;
      return NextResponse.json({
        mode: "reference",
        profilesAvailable: keys.length,
        profile,
      });
    }

    const analysis = getLeagueMatchupAnalysis(homeTeam, awayTeam, league);
    if (!analysis) {
      return NextResponse.json(
        {
          error:
            "No seed baseline for one or both teams in this league. Check team names / league.",
        },
        { status: 404 }
      );
    }
    return NextResponse.json(analysis);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "League analysis failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
