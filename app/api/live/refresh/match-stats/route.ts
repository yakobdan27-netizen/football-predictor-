import { NextResponse } from "next/server";
import { apiSeasonFromDate } from "@/lib/football-api/leagues";
import { enrichFixturesWithBeSoccer } from "@/lib/live/enrich-besoccer";
import { applyApiFixtures } from "@/lib/live/sync-apply";
import { apiSportsLiveProvider } from "@/lib/live/provider";
import {
  getFixtureById,
  getMatchStatsByFixtureId,
} from "@/lib/live/store";
import {
  hasNumericMatchStats,
  matchStatsFieldsFromRow,
} from "@/lib/live/match-stats-fields";
import { LIVE_LEAGUE_IDS } from "@/lib/live/constants";
import { isStatsApiConfigured } from "@/lib/stats-api";
import type { LiveSourceConflictDto } from "@/lib/live/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseConflicts(raw: string | null | undefined): LiveSourceConflictDto[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is LiveSourceConflictDto =>
        !!c &&
        typeof c === "object" &&
        typeof (c as LiveSourceConflictDto).field === "string"
    );
  } catch {
    return [];
  }
}

function truthyParam(raw: string | null): boolean {
  const v = (raw ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Load match stats for one fixture.
 * Query: fixtureId&force=1
 * Without force: return match_stats from DB when present.
 * With force (or missing stats): fetch Stats API and upsert.
 */
export async function POST(request: Request) {
  try {
    let fixtureId = 0;
    let forceApi = false;
    const url = new URL(request.url);
    const q = url.searchParams.get("fixtureId");
    if (q) fixtureId = Number(q);
    forceApi = truthyParam(url.searchParams.get("force"));

    if ((!Number.isFinite(fixtureId) || fixtureId <= 0) && request.method !== "GET") {
      try {
        const body = (await request.json()) as {
          fixtureId?: number;
          force?: boolean;
        };
        if (!Number.isFinite(fixtureId) || fixtureId <= 0) {
          fixtureId = Number(body?.fixtureId);
        }
        if (body?.force === true) forceApi = true;
      } catch {
        /* ignore */
      }
    }
    if (!Number.isFinite(fixtureId) || fixtureId <= 0) {
      return NextResponse.json(
        { ok: false, error: "fixtureId is required" },
        { status: 400 }
      );
    }

    const existingStats = await getMatchStatsByFixtureId(fixtureId).catch(
      () => null
    );
    const existingFixture = await getFixtureById(fixtureId).catch(() => null);

    if (!forceApi && existingStats) {
      const fields = matchStatsFieldsFromRow(existingStats);
      const hasNumericStats = hasNumericMatchStats(fields);

      return NextResponse.json({
        ok: true,
        persisted: true,
        persistedToMatchStats: true,
        persistedToLiveFixtures: existingFixture != null,
        source: "database",
        forced: false,
        statsApiConfigured: isStatsApiConfigured(),
        mapped: existingStats.statsApiMatchId ? 1 : 0,
        fetched: 0,
        upserted: 0,
        matchStatsUpserted: 0,
        fixture: {
          fixtureId,
          leagueId: existingStats.leagueId ?? existingFixture?.leagueId ?? null,
          leagueName: null,
          homeTeam: existingStats.homeTeam,
          awayTeam: existingStats.awayTeam,
          status: existingStats.status ?? existingFixture?.status ?? "NS",
          kickoffUtc: (
            existingStats.kickoffUtc ??
            existingFixture?.kickoffUtc ??
            new Date()
          ).toISOString(),
          homeGoals: existingStats.homeGoals ?? existingFixture?.homeGoals ?? null,
          awayGoals: existingStats.awayGoals ?? existingFixture?.awayGoals ?? null,
          besoccerMatchId: existingStats.statsApiMatchId ?? null,
          ...fields,
          sourceConflicts: parseConflicts(existingStats.sourceConflicts),
          lastSyncedUtc: existingStats.updatedAt.toISOString(),
        },
        enrichmentPresent: true,
        hasNumericStats,
        warning: "Loaded from match_stats (database). Use Force refresh to hit the API.",
      });
    }

    const leagueSet = new Set(LIVE_LEAGUE_IDS);
    const af = await apiSportsLiveProvider.fetchById(fixtureId);
    if (!af) {
      return NextResponse.json(
        { ok: false, error: `API-Football fixture ${fixtureId} not found` },
        { status: 404 }
      );
    }
    if (af.league?.id == null || !leagueSet.has(af.league.id)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Fixture is outside the tracked Big-5 leagues",
        },
        { status: 400 }
      );
    }

    const season =
      af.league?.season ??
      apiSeasonFromDate(af.fixture?.date?.slice(0, 10) ?? "2023-09-01");

    const dateOnly = (af.fixture?.date ?? "").slice(0, 10) || undefined;
    const { fixtures, enrichments, mapped, fetched } =
      await enrichFixturesWithBeSoccer([af], {
        maxStatsFetches: 1,
        discoverFrom: dateOnly,
        discoverTo: dateOnly,
      });

    const merged = fixtures[0] ?? af;
    const enrichment = enrichments.get(fixtureId) ?? null;

    const applied = await applyApiFixtures([merged], season, {
      beSoccerEnrichments: enrichments,
      hydrateEventsOnFt: false,
    });

    const dbRow = await getFixtureById(fixtureId);
    const statsRow = await getMatchStatsByFixtureId(fixtureId);

    if (!dbRow && !statsRow) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Upsert reported success but neither live_fixtures nor match_stats row found",
          upserted: applied.upserted,
          matchStatsUpserted: applied.matchStatsUpserted,
        },
        { status: 503 }
      );
    }

    const source = statsRow ?? dbRow!;
    const fields = matchStatsFieldsFromRow(statsRow ?? undefined);
    // Fall back to denormalized live_fixtures core stats when match_stats missing
    if (!statsRow && dbRow) {
      fields.homeCorners = dbRow.homeCorners ?? null;
      fields.awayCorners = dbRow.awayCorners ?? null;
      fields.homeShots = dbRow.homeShots ?? null;
      fields.awayShots = dbRow.awayShots ?? null;
      fields.homePossession = dbRow.homePossession ?? null;
      fields.awayPossession = dbRow.awayPossession ?? null;
    }
    const hasNumericStats = hasNumericMatchStats(fields);

    return NextResponse.json({
      ok: true,
      persisted: true,
      persistedToMatchStats: statsRow != null,
      persistedToLiveFixtures: dbRow != null,
      source: "api",
      forced: forceApi,
      statsApiConfigured: isStatsApiConfigured(),
      mapped,
      fetched,
      upserted: applied.upserted,
      matchStatsUpserted: applied.matchStatsUpserted,
      inserted: applied.inserted,
      updated: applied.updated,
      fixture: {
        fixtureId,
        leagueId: dbRow?.leagueId ?? statsRow?.leagueId ?? af.league?.id ?? null,
        leagueName: af.league?.name ?? null,
        homeTeam: source.homeTeam,
        awayTeam: source.awayTeam,
        status: source.status ?? dbRow?.status ?? "NS",
        kickoffUtc: (
          statsRow?.kickoffUtc ??
          dbRow?.kickoffUtc ??
          new Date(af.fixture.date)
        ).toISOString(),
        homeGoals: source.homeGoals ?? null,
        awayGoals: source.awayGoals ?? null,
        besoccerMatchId:
          statsRow?.statsApiMatchId ?? dbRow?.besoccerMatchId ?? null,
        ...fields,
        sourceConflicts: parseConflicts(
          statsRow?.sourceConflicts ?? dbRow?.sourceConflicts
        ),
        lastSyncedUtc: (
          statsRow?.updatedAt ??
          dbRow?.lastSyncedUtc ??
          new Date()
        ).toISOString(),
      },
      enrichmentPresent: enrichment != null,
      hasNumericStats,
      rawJson: statsRow?.rawJson ?? enrichment?.rawJson ?? null,
      warning: !isStatsApiConfigured()
        ? "STATS_API_KEY not set — only API-Football scores were saved"
        : fetched === 0
          ? "Could not fetch Stats API /stats for this match (unmapped or provider error)"
          : statsRow == null
            ? "live_fixtures updated but match_stats row missing"
            : !hasNumericStats
              ? "Row saved to match_stats, but Stats API returned no overview stats"
              : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Match stats failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
