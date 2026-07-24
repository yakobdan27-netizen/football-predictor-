import { NextResponse } from "next/server";
import { verifySa2026Roster } from "@/lib/football-api/verify-sa-roster";
import {
  loadSaSeasonRosterStore,
  recomputeSaSeasonCards,
} from "@/lib/prediction-log/sa-season-store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const store = await loadSaSeasonRosterStore();
    return NextResponse.json({ store });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load SA roster";
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
      const store = await recomputeSaSeasonCards();
      return NextResponse.json({ ok: true, store });
    }
    const result = await verifySa2026Roster();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "SA roster verify failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
