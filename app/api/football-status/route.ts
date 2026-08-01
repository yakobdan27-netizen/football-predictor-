import { NextResponse } from "next/server";
import {
  API_KEY_NOT_CONFIGURED_MSG,
  apiFootballGet,
  getApiFootballKey,
  logApiFootballHealth,
} from "@/lib/football-api/client";
import { normalizeFootballStatus } from "@/lib/football-api/status";
import { confirmLeaguesAndSeason } from "@/lib/football-api/endpoint-map";

/**
 * GET /api/football-status
 * Verifies APISPORTS_KEY / API_FOOTBALL_KEY + x-apisports-key against /status.
 * League confirm tries season 2025 then 2026.
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
    await logApiFootballHealth();
    const raw = await apiFootballGet<unknown>("/status");
    const normalized = normalizeFootballStatus(raw);

    let leagueConfirm = await confirmLeaguesAndSeason(2025);
    let leagueSeasonTried = 2025;
    if (!leagueConfirm.ok || leagueConfirm.planGated) {
      const alt = await confirmLeaguesAndSeason(2026);
      if (alt.ok && !alt.planGated) {
        leagueConfirm = alt;
        leagueSeasonTried = 2026;
      } else if (
        alt.leagues.filter((l) => l.ok).length >
        leagueConfirm.leagues.filter((l) => l.ok).length
      ) {
        leagueConfirm = alt;
        leagueSeasonTried = 2026;
      }
    }

    return NextResponse.json({
      ok: true,
      ...normalized,
      status: raw,
      leagueConfirm,
      leagueSeasonTried,
      planCovered: leagueConfirm ? !leagueConfirm.planGated : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Status check failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }
}
