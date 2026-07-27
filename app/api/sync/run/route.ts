import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin/auth";
import { syncSchedule } from "@/lib/live/sync-daily";

export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * POST /api/sync/run?scope=schedule
 * Admin-gated manual schedule sync (same path as daily cron).
 */
export async function POST(request: Request) {
  const denied = await requireAdminRequest(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const scope = (url.searchParams.get("scope") ?? "schedule").toLowerCase();
  if (scope !== "schedule") {
    return NextResponse.json(
      { error: `Unsupported scope "${scope}". Use scope=schedule.` },
      { status: 400 }
    );
  }

  try {
    const { confirmLeaguesAndSeason } = await import(
      "@/lib/football-api/endpoint-map"
    );
    const leagueConfirm = await confirmLeaguesAndSeason();
    const summary = await syncSchedule();
    return NextResponse.json(
      {
        ok: summary.ok,
        scope: "schedule",
        fetched: summary.fetched,
        inserted: summary.inserted,
        updated: summary.updated,
        skipped: summary.skipped,
        errors: summary.errors,
        from: summary.from,
        to: summary.to,
        season: summary.season,
        leagues: summary.leagues,
        status: summary.status,
        reason: summary.reason,
        settledEmitted: summary.settledEmitted,
        leagueConfirm,
        planCovered: !leagueConfirm.planGated,
      },
      { status: summary.ok ? 200 : 503 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    return NextResponse.json(
      {
        ok: false,
        fetched: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: [msg],
        status: "error",
        reason: msg,
      },
      { status: 503 }
    );
  }
}
