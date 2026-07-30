import { NextResponse } from "next/server";
import {
  STATS_API_KEY_NOT_CONFIGURED_MSG,
  STATS_API_PL_COMPETITION_ID,
  statsApiGet,
  getStatsApiKey,
  isStatsApiConfigured,
  discoverStatsApiMatches,
} from "@/lib/stats-api";
import { SAMPLE_DATE_DEFAULT } from "@/lib/live/sample-window";

/**
 * GET /api/besoccer-status (legacy path) — verifies STATS_API_KEY + PL sample-day list.
 */
export async function GET() {
  if (!isStatsApiConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        error: STATS_API_KEY_NOT_CONFIGURED_MSG,
        provider: "thestatsapi",
      },
      { status: 503 }
    );
  }

  try {
    getStatsApiKey();
    const health = await statsApiGet<{ status?: string; timestamp?: string }>(
      "/health"
    );
    const day = SAMPLE_DATE_DEFAULT;

    let matchesProbe: {
      ok: boolean;
      error?: string;
      count?: number;
      dateFrom?: string;
      dateTo?: string;
      competitionId?: string;
    } = {
      ok: true,
      dateFrom: day,
      dateTo: day,
      competitionId: STATS_API_PL_COMPETITION_ID,
    };

    try {
      const listed = await discoverStatsApiMatches({
        dateFrom: day,
        dateTo: day,
        maxPages: 2,
        competitionIds: [STATS_API_PL_COMPETITION_ID],
      });
      matchesProbe = {
        ok: true,
        count: listed.length,
        dateFrom: day,
        dateTo: day,
        competitionId: STATS_API_PL_COMPETITION_ID,
      };
    } catch (e) {
      matchesProbe = {
        ok: false,
        error: e instanceof Error ? e.message : "matches probe failed",
        dateFrom: day,
        dateTo: day,
        competitionId: STATS_API_PL_COMPETITION_ID,
      };
    }

    return NextResponse.json({
      ok: matchesProbe.ok,
      configured: true,
      provider: "thestatsapi",
      health,
      matchesProbe,
      lookbackDays: 0,
      note: matchesProbe.ok
        ? `The Stats API connected — sample probe ${day} (PL). Live Refresh only allows 2022-08-01–2024-12-31 (AF seasons 2022–2024); stats are per-match /stats.`
        : `Health OK but matches failed: ${matchesProbe.error}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Status check failed";
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        provider: "thestatsapi",
        error: msg,
      },
      { status: 503 }
    );
  }
}
