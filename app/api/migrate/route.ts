import { NextResponse } from "next/server";
import {
  batchIndexPopulated,
  loadBatchIndex,
  saveBatch,
} from "@/lib/prediction-log/club-store";
import { syncBatchToClubHistories } from "@/lib/prediction-log/club-history-writer";
import type { PredictionBatch } from "@/lib/prediction-log/types";

interface MigrateBody {
  batches?: PredictionBatch[];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as MigrateBody;
    const existing = await loadBatchIndex();
    if (batchIndexPopulated(existing)) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        message: "KV already has batches",
      });
    }

    const batches = body.batches ?? [];
    let count = 0;
    for (const batch of batches) {
      const synced = await syncBatchToClubHistories(batch);
      await saveBatch(synced);
      count++;
    }

    return NextResponse.json({ ok: true, migrated: count });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Migration failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
