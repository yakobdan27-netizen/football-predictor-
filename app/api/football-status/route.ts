import { NextResponse } from "next/server";
import {
  API_KEY_NOT_CONFIGURED_MSG,
  apiFootballGet,
  getApiFootballKey,
} from "@/lib/football-api/client";
import { normalizeFootballStatus } from "@/lib/football-api/status";

/**
 * GET /api/football-status
 * Verifies APISPORTS_KEY / API_FOOTBALL_KEY + x-apisports-key against /status.
 */
export async function GET() {
  try {
    getApiFootballKey();
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : API_KEY_NOT_CONFIGURED_MSG,
      },
      { status: 503 }
    );
  }

  try {
    const raw = await apiFootballGet<unknown>("/status");
    const normalized = normalizeFootballStatus(raw);
    return NextResponse.json({
      ok: true,
      ...normalized,
      status: raw,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Status check failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }
}
