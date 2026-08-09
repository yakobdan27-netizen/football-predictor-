import { NextResponse } from "next/server";
import { listSlipBatches } from "@/lib/slip-builder/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "20");
    const batches = await listSlipBatches(
      Number.isFinite(limit) ? Math.min(100, Math.max(1, limit)) : 20
    );
    return NextResponse.json({ batches });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to list batches";
    return NextResponse.json({ error: msg, batches: [] }, { status: 500 });
  }
}
