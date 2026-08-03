import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db/init";
import {
  auditHistCoverage,
  formatCoverageTable,
} from "@/lib/hist/coverage-audit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/hist/coverage — read-only 35-bucket hist_* audit (no AF fetches).
 */
export async function GET() {
  try {
    await ensureSchema();
    const report = await auditHistCoverage();
    return NextResponse.json({
      ok: true,
      ...report,
      table: formatCoverageTable(report),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Coverage audit failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
