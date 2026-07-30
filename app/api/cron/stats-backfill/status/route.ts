import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/live/cron-auth";
import {
  countBackfillProgress,
  readBackfillCursor,
} from "@/lib/live/stats-backfill-store";
import { ensureSchema } from "@/lib/db/init";
import {
  STATS_BACKFILL_LEAGUES,
  STATS_BACKFILL_SEASONS,
  backfillCellAt,
} from "@/lib/live/stats-backfill-constants";

export const maxDuration = 30;
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureSchema();
    const cursor = await readBackfillCursor();
    const progress = await countBackfillProgress();
    const cell =
      cursor != null ? backfillCellAt(cursor.cellIndex) : backfillCellAt(0);
    const totalCells =
      STATS_BACKFILL_LEAGUES.length * STATS_BACKFILL_SEASONS.length;
    const done = cursor?.phase === "done";

    return NextResponse.json({
      ok: true,
      done,
      cursor,
      cell: cell
        ? {
            leagueName: cell.leagueName,
            leagueId: cell.leagueId,
            season: cell.season,
          }
        : null,
      totalCells,
      progress,
      leagues: [...STATS_BACKFILL_LEAGUES],
      seasons: [...STATS_BACKFILL_SEASONS],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }
}
