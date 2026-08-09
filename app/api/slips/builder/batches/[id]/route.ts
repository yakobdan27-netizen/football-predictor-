import { NextResponse } from "next/server";
import { loadSlipBatch } from "@/lib/slip-builder/store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const batchId = Number(id);
    if (!Number.isFinite(batchId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const batch = await loadSlipBatch(batchId);
    if (!batch) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ batch });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load batch";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
