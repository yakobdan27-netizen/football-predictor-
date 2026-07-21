import { NextResponse } from "next/server";
import { verifyLl2026Roster } from "@/lib/football-api/verify-ll-roster";
import {
  loadLlSeasonRosterStore,
  recomputeLlSeasonCards,
} from "@/lib/prediction-log/ll-season-store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const store = await loadLlSeasonRosterStore();
    return NextResponse.json({ store });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load LL roster";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      verify?: boolean;
      recompute?: boolean;
    };
    if (body.recompute && !body.verify) {
      const store = await recomputeLlSeasonCards();
      return NextResponse.json({ ok: true, store });
    }
    const result = await verifyLl2026Roster();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "LL roster verify failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
