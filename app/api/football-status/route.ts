import { NextResponse } from "next/server";
import { apiFootballGet, getApiFootballKey } from "@/lib/football-api/client";

/**
 * GET /api/football-status
 * Verifies API_FOOTBALL_KEY + x-apisports-key against /status (server-only).
 */
export async function GET() {
  try {
    getApiFootballKey();
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "API_FOOTBALL_KEY is not configured",
      },
      { status: 503 }
    );
  }

  try {
    const status = await apiFootballGet<unknown>("/status");
    return NextResponse.json({ ok: true, status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Status check failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }
}
