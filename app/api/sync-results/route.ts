import { NextResponse } from "next/server";
import {
  replaceMatchResultsFromApi,
  syncPredictionLogResults,
} from "@/lib/football-api/sync-prediction-log";

export async function POST(request: Request) {
  try {
    let batchId: string | undefined;
    let replaceMatchIds: string[] | undefined;
    try {
      const body = (await request.json()) as {
        batchId?: string;
        replaceMatchIds?: string[];
      };
      batchId = body?.batchId;
      replaceMatchIds = body?.replaceMatchIds;
    } catch {
      batchId = undefined;
    }

    if (replaceMatchIds?.length && batchId) {
      const summary = await replaceMatchResultsFromApi(batchId, replaceMatchIds);
      return NextResponse.json({ ok: true, ...summary });
    }

    const summary = await syncPredictionLogResults(batchId);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to sync results";
    const status = msg.includes("API_FOOTBALL_KEY") ? 503 : 500;
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
