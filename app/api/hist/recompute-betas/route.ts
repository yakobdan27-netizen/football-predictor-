import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db/init";
import { recomputeDerivedFromHist } from "@/lib/hist/recompute-derived";

export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * POST /api/hist/recompute-betas
 * Empirical BETA_2H + league priors + team_half_stats + team_ratings from hist_*.
 */
export async function POST() {
  try {
    await ensureSchema();
    const result = await recomputeDerivedFromHist();
    return NextResponse.json({
      ok: true,
      betas: result.betas,
      priors: result.priors,
      teamHalfStats: result.teamHalfStats,
      teamRatings: result.teamRatings,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
