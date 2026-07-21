import { NextResponse } from "next/server";
import { verifyPl2026Roster } from "@/lib/football-api/verify-pl-roster";
import {
  loadPlSeasonRosterStore,
  recomputePlSeasonCards,
} from "@/lib/prediction-log/pl-season-store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const store = await loadPlSeasonRosterStore();
    return NextResponse.json({ store });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load PL roster";
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
      const store = await recomputePlSeasonCards();
      return NextResponse.json({ ok: true, store });
    }
    const result = await verifyPl2026Roster();
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "PL roster verify failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
