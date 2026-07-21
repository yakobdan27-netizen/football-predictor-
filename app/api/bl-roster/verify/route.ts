import { NextResponse } from "next/server";
import { verifyBl2026Roster } from "@/lib/football-api/verify-bl-roster";
import {
  loadBlSeasonRosterStore,
  recomputeBlSeasonCards,
} from "@/lib/prediction-log/bl-season-store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const store = await loadBlSeasonRosterStore();
    return NextResponse.json({ store });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load BL roster";
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
      const store = await recomputeBlSeasonCards();
      return NextResponse.json({ ok: true, store });
    }
    const result = await verifyBl2026Roster();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "BL roster verify failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
