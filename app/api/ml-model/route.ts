import { NextResponse } from "next/server";
import { loadMlClassifier } from "@/lib/prediction-log/ml-model-store";
import { getJson } from "@/lib/prediction-log/kv";
import { KV_KEYS } from "@/lib/prediction-log/kv-keys";

export async function GET() {
  try {
    const classifier = await loadMlClassifier();
    const leagueBaselines = await getJson(KV_KEYS.leagueBaselines);
    return NextResponse.json({ classifier, leagueBaselines });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load ML model";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
