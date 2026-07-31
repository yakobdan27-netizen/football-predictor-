import { NextResponse } from "next/server";
import { fetchAndCacheOddsForFixture } from "@/lib/bets/odds-fetch";
import { ensureBetSettlementRegistered } from "@/lib/bets/register-settlement";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  ensureBetSettlementRegistered();
  try {
    const body = (await request.json()) as { fixtureId?: number };
    const fixtureId = Number(body?.fixtureId);
    if (!Number.isFinite(fixtureId) || fixtureId <= 0) {
      return NextResponse.json(
        { ok: false, error: "fixtureId required" },
        { status: 400 }
      );
    }
    const result = await fetchAndCacheOddsForFixture(fixtureId);
    return NextResponse.json({ ok: true, fixtureId, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Odds fetch failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
