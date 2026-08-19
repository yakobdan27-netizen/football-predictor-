import { NextResponse } from "next/server";
import { loadLatestAdvisoryRun } from "@/lib/market-advisory/persist";
import { toUiPayload } from "@/lib/market-advisory/run-msam";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ fixtureId: string }> }
) {
  try {
    const { fixtureId: fixtureIdStr } = await context.params;
    const fixtureId = Number(fixtureIdStr);
    if (!Number.isFinite(fixtureId)) {
      return NextResponse.json({ ok: false, error: "Invalid fixtureId" }, { status: 400 });
    }

    const result = await loadLatestAdvisoryRun(fixtureId);
    if (!result) {
      return NextResponse.json({ ok: true, advisory: null });
    }

    return NextResponse.json({ ok: true, advisory: toUiPayload(result), result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
