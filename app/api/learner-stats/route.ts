import { NextResponse } from "next/server";
import { loadLearnerStatsStore } from "@/lib/prediction-log/learner-stats-store";

export async function GET() {
  try {
    const stats = await loadLearnerStatsStore();
    return NextResponse.json({ stats });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load learner stats";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
