import { NextResponse } from "next/server";
import { settleAllOpenFinished } from "@/lib/bets/settle";
import { ensureBetSettlementRegistered } from "@/lib/bets/register-settlement";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  ensureBetSettlementRegistered();
  try {
    const result = await settleAllOpenFinished();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Settle failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
