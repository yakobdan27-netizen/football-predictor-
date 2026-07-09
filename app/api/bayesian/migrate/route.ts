import { NextResponse } from "next/server";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import { migrateClubBayesianFromBatches } from "@/lib/prediction-log/bayesian-migrate";
import { loadTeamsQualityStore } from "@/lib/prediction-log/teams-quality-store";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { force?: boolean };
    const batches = await loadAllBatches();
    const teamsQuality = await loadTeamsQualityStore().catch(() => null);
    const result = await migrateClubBayesianFromBatches(batches, teamsQuality, body.force === true);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bayesian migration failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
