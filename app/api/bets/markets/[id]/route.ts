import { NextResponse } from "next/server";
import { updateMarketOdd } from "@/lib/bets/store";
import { ensureBetSettlementRegistered } from "@/lib/bets/register-settlement";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  ensureBetSettlementRegistered();
  try {
    const { id: idRaw } = await context.params;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }
    const body = (await request.json()) as { odd?: number | null };
    const odd =
      body.odd == null || body.odd === ("" as unknown)
        ? null
        : Number(body.odd);
    if (odd != null && (!Number.isFinite(odd) || odd <= 1)) {
      return NextResponse.json(
        { ok: false, error: "odd must be > 1 or null" },
        { status: 400 }
      );
    }
    const market = await updateMarketOdd(id, odd);
    if (!market) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, market });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Update failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
