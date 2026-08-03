import { NextResponse } from "next/server";
import { runHistBackfillChunk } from "@/lib/hist/backfill";

export const maxDuration = 60;
export const runtime = "nodejs";

type Body = { gapPriority?: boolean };

/**
 * POST /api/hist/backfill
 * Public manual kick (same work as cron hist-backfill).
 * Body `{ "gapPriority": true }` drains incomplete coverage buckets first.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const summary = await runHistBackfillChunk({
      gapPriority: body.gapPriority === true,
    });
    return NextResponse.json(summary, {
      status: summary.ok ? 200 : 503,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "Use POST to run a hist backfill chunk" },
    { status: 405 }
  );
}
