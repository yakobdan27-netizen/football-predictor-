import { NextResponse } from "next/server";
import { previewSampleDay } from "@/lib/live/sync-live";
import { isSampleDateAllowed } from "@/lib/live/sample-window";

export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * Preview fixtures for a sample day.
 * Query: ?date=YYYY-MM-DD&force=1
 * Without force: returns DB cache when present; otherwise fetches API and saves.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? "";
  const forceRaw = (url.searchParams.get("force") ?? "").toLowerCase();
  const forceApi = forceRaw === "1" || forceRaw === "true" || forceRaw === "yes";

  if (!isSampleDateAllowed(date)) {
    return NextResponse.json(
      {
        ok: false,
        date,
        season: 0,
        matchCount: 0,
        matches: [],
        error: "Pick a date between 2022-08-01 and 2024-12-31 (AF seasons 2022–2024)",
      },
      { status: 400 }
    );
  }

  const preview = await previewSampleDay(date, { forceApi });
  return NextResponse.json(preview, {
    status: preview.ok ? 200 : 503,
  });
}
