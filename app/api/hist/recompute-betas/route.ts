import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db/init";
import { recomputeLeagueBetas } from "@/lib/hist/recompute-betas";

export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * POST /api/hist/recompute-betas
 * Empirical per-league BETA_2H from hist_* → hist_meta.
 */
export async function POST() {
  try {
    await ensureSchema();
    const result = await recomputeLeagueBetas();
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
