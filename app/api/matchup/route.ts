import { NextResponse } from "next/server";
import { loadMatchupCache } from "@/lib/prediction-log/matchup-cache";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const a = searchParams.get("a");
    const b = searchParams.get("b");
    if (!a || !b) {
      return NextResponse.json({ error: "Missing a or b" }, { status: 400 });
    }
    const matchup = await loadMatchupCache(a, b);
    return NextResponse.json({ matchup });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load matchup";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
