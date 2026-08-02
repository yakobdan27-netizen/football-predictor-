import { NextResponse } from "next/server";
import { logApiFootballHealth } from "@/lib/apiClient";
import { loadHistProfilesForTeams } from "@/lib/hist/team-half-intensities";
import { warmBetaCache } from "@/lib/hist/recompute-betas";
import {
  fillProfileGapsOnDemand,
  readCachedProfilesForTeams,
} from "@/lib/prediction-log/two-h-heavy/fetch-profiles";
import type { VenueSide } from "@/lib/prediction-log/two-h-heavy/types";

/**
 * GET /api/two-h-heavy/profiles?q=Team|home|League&q=...
 * Manual-first: hist + KV, then on-demand AF gap fill (fillGaps=0 to skip).
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const qs = url.searchParams.getAll("q");
    const requests: { team: string; league: string; venue: VenueSide }[] = [];
    const fillGapsParam = url.searchParams.get("fillGaps");
    const fillGaps = fillGapsParam !== "0" && fillGapsParam !== "false";

    for (const raw of qs) {
      const parts = raw.split("|");
      if (parts.length < 3) continue;
      const team = parts[0]?.trim();
      const venue = parts[1]?.trim().toLowerCase();
      const league = parts.slice(2).join("|").trim();
      if (!team || !league || (venue !== "home" && venue !== "away")) continue;
      requests.push({ team, venue, league });
    }

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
      return NextResponse.json({
        profiles: {},
        histProfiles: {},
        apiUnavailable: false,
        filled: 0,
      });
    }

    await warmBetaCache().catch(() => ({}));
    const [profiles, histProfiles] = await Promise.all([
      readCachedProfilesForTeams(requests),
      loadHistProfilesForTeams(requests).catch(() => ({})),
    ]);

    let apiUnavailable = false;
    let nextProfiles = profiles;
    let filled = 0;

    if (fillGaps) {
      const health = await logApiFootballHealth();
      if (!health.ok) {
        apiUnavailable = true;
      } else {
        const gap = await fillProfileGapsOnDemand(requests, {
          profiles,
          histProfiles,
        });
        nextProfiles = gap.profiles;
        filled = gap.filled;
      }
    }

    return NextResponse.json({
      profiles: nextProfiles,
      histProfiles,
      apiUnavailable,
      filled,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load profiles";
    return NextResponse.json(
      {
        error: msg,
        profiles: {},
        histProfiles: {},
        apiUnavailable: true,
        filled: 0,
      },
      { status: 200 }
    );
  }
}
