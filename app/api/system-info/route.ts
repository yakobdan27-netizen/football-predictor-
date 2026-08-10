import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db/init";
import { buildSystemInformation } from "@/lib/hist/system-info";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/system-info — hist inventory gate + DIEH half-params readiness.
 * Read-only; reflects latest DB after daily drain / backfill.
 */
export async function GET() {
  try {
    await ensureSchema();
    const info = await buildSystemInformation();
    return NextResponse.json({ ok: true, ...info });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "System info failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
