import { NextResponse } from "next/server";
import { isApiFootballKeyError } from "@/lib/football-api/client";
import {
  DEFAULT_UPCOMING_NEXT,
  NEXT_MATCHES_LEAGUES,
  fetchUpcomingForLeague,
  type NextMatchesLeague,
} from "@/lib/football-api/fetch-upcoming-league";
import { registerMatchCentreFixtures } from "@/lib/match-centre/register-fixtures";

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

    if (result.fixtures.length > 0) {
      registerMatchCentreFixtures(
        result.fixtures.map((f) => ({
          apiFixtureId: f.apiFixtureId,
          kickoffIso: f.kickoffIso,
          matchDate: f.matchDate,
          status: f.status,
          home: f.home,
          away: f.away,
          venue: f.venue,
          leagueId: f.leagueId,
          league: f.league,
        }))
      ).catch((e) => {
        console.warn(
          "[fixtures/upcoming] match-centre register failed:",
          e instanceof Error ? e.message : e
        );
      });
    }

    let warning = result.warning;
    if (warning && /quota|limit_day|requests/i.test(warning)) {
      warning = "API quota reached";
    } else if (warning && isApiFootballKeyError(warning)) {
      warning = "API key invalid — check env";
    } else if (
      warning &&
      /do not have access to this season|Free plans/i.test(warning)
    ) {
      warning = `API unavailable (plan/season): ${warning}`;
    }

    return NextResponse.json({
      ok: true,
      season: result.season,
      league: result.league,
      leagueId: result.leagueId,
      fixtures: result.fixtures,
      fromCache: result.fromCache,
      warning,
      filteredCount: result.filteredCount ?? 0,
      filterReasons: result.filterReasons ?? {},
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load upcoming fixtures";
    const status = isApiFootballKeyError(msg) ? 503 : 502;
    const warning = isApiFootballKeyError(msg)
      ? "API key invalid — check env"
      : /quota|limit/i.test(msg)
        ? "API quota reached"
        : "API unavailable — try again or enter batches manually.";
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        warning,
        fixtures: [],
      },
      { status }
    );
  }
}
