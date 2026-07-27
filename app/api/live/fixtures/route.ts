import { NextResponse } from "next/server";
import { LEAGUE_API_IDS } from "@/lib/football-api/leagues";
import { queryFixturesForTab, readSyncMeta } from "@/lib/live/store";
import type { LiveTab } from "@/lib/live/types";

export const runtime = "nodejs";

const TABS = new Set<LiveTab>(["live", "today", "upcoming", "finished"]);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const tabRaw = (url.searchParams.get("tab") ?? "today").toLowerCase();
    const tab = (TABS.has(tabRaw as LiveTab) ? tabRaw : "today") as LiveTab;
    const leagueName = url.searchParams.get("league")?.trim() || null;
    const leagueIdParam = url.searchParams.get("leagueId");
    let leagueId: number | null = null;
    if (leagueIdParam) {
      const n = Number(leagueIdParam);
      leagueId = Number.isFinite(n) ? n : null;
    } else if (leagueName && leagueName in LEAGUE_API_IDS) {
      leagueId = LEAGUE_API_IDS[leagueName as keyof typeof LEAGUE_API_IDS];
    }

    const [result, syncMeta] = await Promise.all([
      queryFixturesForTab({ tab, leagueId }),
      readSyncMeta(),
    ]);
    return NextResponse.json({
      ok: true,
      tab,
      leagueId,
      fixtures: result.fixtures,
      syncedAt: result.syncedAt ?? syncMeta?.lastSyncAt ?? null,
      stale: result.stale,
      syncMeta,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load live fixtures";
    const syncMeta = await readSyncMeta().catch(() => null);
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        fixtures: [],
        syncedAt: syncMeta?.lastSyncAt ?? null,
        stale: true,
        syncMeta,
      },
      { status: 503 }
    );
  }
}
