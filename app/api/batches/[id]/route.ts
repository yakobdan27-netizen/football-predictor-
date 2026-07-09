import { NextResponse } from "next/server";
import { deleteBatch, loadBatch } from "@/lib/prediction-log/club-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const batch = await loadBatch(id);
    if (!batch) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ batch });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load batch";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteBatch(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to delete batch";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
