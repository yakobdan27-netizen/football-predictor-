import { NextResponse } from "next/server";
import { getApiFootballPlanInfo } from "@/lib/football-api/plan";
import { runManualLiveRefresh } from "@/lib/live/sync-live";
import {
  isSampleDateAllowed,
  resolveSampleWindow,
} from "@/lib/live/sample-window";

export const maxDuration = 120;
export const runtime = "nodejs";

/**
 * Manual live + Stats API refresh for one sample day.
 * Query: ?date=YYYY-MM-DD (required; window follows AF plan) & optional mode=sample-day
 */
export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? "";
    const plan = await getApiFootballPlanInfo();
    const window = resolveSampleWindow(plan.isFree);
    if (!isSampleDateAllowed(date, window)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Pick a date between ${window.min} and ${window.max}${
            window.isFree
              ? " (AF free-plan seasons 2022–2024 — upgrade to Pro for more)"
              : ""
          }`,
          upserted: 0,
          settledEmitted: 0,
          mode: "sample-day",
          sampleDate: date || null,
          beSoccerConfigured: false,
          steps: [],
          apiFootballFetched: 0,
          beSoccerMapped: 0,
          beSoccerFetched: 0,
          beSoccerSkippedSeason: 0,
          conflictCount: 0,
          fixtures: [],
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          sampleWindow: window,
          plan: plan.plan,
        },
        { status: 400 }
      );
    }

    const summary = await runManualLiveRefresh({
      mode: "sample-day",
      date,
    });
    return NextResponse.json(
      {
        ...summary,
        sampleWindow: window,
        plan: plan.plan,
      },
      {
        status: summary.ok || summary.skippedRun ? 200 : 503,
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Live refresh failed";
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        upserted: 0,
        settledEmitted: 0,
        mode: "sample-day",
        beSoccerConfigured: false,
        steps: [],
        apiFootballFetched: 0,
        beSoccerMapped: 0,
        beSoccerFetched: 0,
        beSoccerSkippedSeason: 0,
        conflictCount: 0,
        fixtures: [],
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
