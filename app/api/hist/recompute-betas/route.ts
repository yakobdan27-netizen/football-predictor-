import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db/init";
import { recomputeLeaguePriors } from "@/lib/hist/league-priors";
import { persistTeamHalfStatsFromHist } from "@/lib/hist/persist-team-half-stats";
import { recomputeLeagueBetas } from "@/lib/hist/recompute-betas";

export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * POST /api/hist/recompute-betas
 * Empirical BETA_2H + league priors + team_half_stats from hist_*.
 */
export async function POST() {
  try {
    await ensureSchema();
    const betas = await recomputeLeagueBetas();
    const priors = await recomputeLeaguePriors();
    const half = await persistTeamHalfStatsFromHist();
    return NextResponse.json({
      ok: true,
      betas,
      priors,
      teamHalfStats: half,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
