import { NextResponse } from "next/server";
import { isApiFootballKeyError } from "@/lib/football-api/client";
import {
  replaceMatchResultsFromApi,
} from "@/lib/football-api/sync-prediction-log";
import { syncAllPredictionLogFromApi } from "@/lib/football-api/sync-all-prediction-log-from-api";
import { syncBatchFromApi } from "@/lib/football-api/sync-batch-from-api";
import { countTraceStatusesAcrossBatches } from "@/lib/prediction-log/result-trace";
import { loadAllBatches } from "@/lib/prediction-log/club-store";

export async function GET() {
  try {
    const batches = await loadAllBatches();
    const trace = countTraceStatusesAcrossBatches(batches);
    return NextResponse.json({ ok: true, trace });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load trace status";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    let batchId: string | undefined;
    let replaceMatchIds: string[] | undefined;
    let batchFill = false;
    try {
      const body = (await request.json()) as {
        batchId?: string;
        replaceMatchIds?: string[];
        batchFill?: boolean;
      };
      batchId = body?.batchId;
      replaceMatchIds = body?.replaceMatchIds;
      batchFill = body?.batchFill === true;
    } catch {
      batchId = undefined;
    }

    if (replaceMatchIds?.length && batchId) {
      const summary = await replaceMatchResultsFromApi(batchId, replaceMatchIds);
      return NextResponse.json({ ok: true, ...summary });
    }

    if (batchFill && batchId) {
      const summary = await syncBatchFromApi(batchId);
      return NextResponse.json({
        ok: !summary.unavailable,
        ...summary,
        unavailable: summary.unavailable,
        banner: summary.unavailable
          ? "Auto-fill unavailable right now — enter results manually."
          : undefined,
      });
    }

    const summary = await syncAllPredictionLogFromApi({ batchId });
    return NextResponse.json({
      ok: !summary.unavailable,
      ...summary,
      unavailable: summary.unavailable,
      banner: summary.unavailable
        ? "Auto-fill unavailable right now — enter results manually."
        : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to sync results";
    const status = isApiFootballKeyError(msg) ? 503 : 500;
    return NextResponse.json(
      {
        error: msg,
        unavailable: true,
        banner: "Auto-fill unavailable right now — enter results manually.",
      },
      { status }
    );
  }
}
