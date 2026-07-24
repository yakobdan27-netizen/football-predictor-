import { NextResponse } from "next/server";
import { verifyL12026Roster } from "@/lib/football-api/verify-l1-roster";
import {
  loadL1SeasonRosterStore,
  recomputeL1SeasonCards,
} from "@/lib/prediction-log/l1-season-store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const store = await loadL1SeasonRosterStore();
    return NextResponse.json({ store });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load L1 roster";
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
      const store = await recomputeL1SeasonCards();
      return NextResponse.json({ ok: true, store });
    }
    const result = await verifyL12026Roster();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "L1 roster verify failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
