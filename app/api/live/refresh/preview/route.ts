import { NextResponse } from "next/server";
import { getApiFootballPlanInfo } from "@/lib/football-api/plan";
import { previewSampleDay } from "@/lib/live/sync-live";
import {
  isSampleDateAllowed,
  resolveSampleWindow,
} from "@/lib/live/sample-window";

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

  const plan = await getApiFootballPlanInfo();
  const window = resolveSampleWindow(plan.isFree);

  if (!isSampleDateAllowed(date, window)) {
    return NextResponse.json(
      {
        ok: false,
        date,
        season: 0,
        matchCount: 0,
        matches: [],
        error: `Pick a date between ${window.min} and ${window.max}${
          window.isFree
            ? " (AF free-plan seasons 2022–2024 — upgrade to Pro for more)"
            : ""
        }`,
        sampleWindow: window,
        plan: plan.plan,
      },
      { status: 400 }
    );
  }

  const preview = await previewSampleDay(date, { forceApi });
  return NextResponse.json(
    {
      ...preview,
      sampleWindow: window,
      plan: plan.plan,
    },
    {
      status: preview.ok ? 200 : 503,
    }
  );
}
