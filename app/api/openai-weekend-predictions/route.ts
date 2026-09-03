import { NextResponse } from "next/server";
import { isOpenAiConfigured } from "@/lib/openai/client";
import {
  generateOpenAiWeekendPredictions,
  getCurrentWeekendBatchId,
  loadLatestOpenAiRun,
} from "@/lib/prediction-log/openai-weekend-predictor";

export const maxDuration = 120;
export const runtime = "nodejs";

export async function GET() {
  try {
    const weekendBatchId = await getCurrentWeekendBatchId();
    const run = await loadLatestOpenAiRun(weekendBatchId);

    if (!run) {
      return NextResponse.json({
        ok: true,
        empty: true,
        weekendBatchId,
      });
    }

    return NextResponse.json({
      ok: true,
      empty: false,
      ...run,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (!isOpenAiConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "OPENAI_API_KEY is not configured. Set it in .env.local or Vercel project settings.",
      },
      { status: 503 }
    );
  }

  try {
    const url = new URL(request.url);
    const refresh =
      url.searchParams.get("refresh") === "1" ||
      url.searchParams.get("refresh") === "true";

    const result = await generateOpenAiWeekendPredictions({ refresh });

    return NextResponse.json({
      ok: true,
      empty: false,
      ...result,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}
