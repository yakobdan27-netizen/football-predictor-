import { NextResponse } from "next/server";
import { loadClubRecord, saveClubRecord } from "@/lib/prediction-log/club-store";
import { applyCapacity } from "@/lib/prediction-log/club-capacity";
import type { ClubRecord, HistoryEntry, HistoryTypeKey } from "@/lib/prediction-log/club-record-types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ clubId: string }> }
) {
  try {
    const { clubId } = await params;
    const record = await loadClubRecord(clubId);
    if (!record) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ club: record });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load club";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

interface PatchBody {
  historyType?: HistoryTypeKey;
  entryId?: string;
  patch?: Partial<HistoryEntry>;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ clubId: string }> }
) {
  try {
    const { clubId } = await params;
    const body = (await request.json()) as PatchBody;
    const record = await loadClubRecord(clubId);
    if (!record || !body.historyType || !body.entryId || !body.patch) {
      return NextResponse.json({ error: "Invalid patch" }, { status: 400 });
    }

    const list = [...record.histories[body.historyType]];
    const idx = list.findIndex((e) => e.id === body.entryId && !e.superseded);
    if (idx < 0) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    const old = list[idx]!;
    list[idx] = { ...old, superseded: true, editedAt: new Date().toISOString() };
    list.push({
      ...old,
      ...body.patch,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      editedAt: new Date().toISOString(),
      superseded: false,
    });

    const updated: ClubRecord = applyCapacity({
      ...record,
      histories: { ...record.histories, [body.historyType]: list },
    });
    await saveClubRecord(updated);
    return NextResponse.json({ ok: true, club: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to patch club";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
