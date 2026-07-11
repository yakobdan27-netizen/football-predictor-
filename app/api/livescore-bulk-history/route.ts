import { NextResponse } from "next/server";
import { runBulkLast5History } from "@/lib/livescore/bulk-last5";

export const maxDuration = 60;
export const runtime = "nodejs";

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let body: {
      leagues?: string[];
      season?: string;
      maxLeagues?: number;
      retryFailedFirst?: boolean;
    } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      body = {};
    }

    const summary = await runBulkLast5History({
      leagues: body.leagues,
      maxLeagues: body.maxLeagues ?? 1,
      retryFailedFirst: body.retryFailedFirst,
    });

    return NextResponse.json({ ok: true, season: "2025/2026", ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bulk Livescore history failed";
    console.error("[livescore-bulk-history]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Vercel Cron uses GET by default for some setups; accept GET with same auth. */
export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runBulkLast5History({ maxLeagues: 1 });
    return NextResponse.json({ ok: true, season: "2025/2026", ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bulk Livescore history failed";
    console.error("[livescore-bulk-history]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
