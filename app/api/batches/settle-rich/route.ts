import { NextResponse } from "next/server";
import { batchAllMatchesRichSettlement } from "@/lib/prediction-log/match-settlement";
import { persistRichSettlementBatch } from "@/lib/prediction-log/persist-rich-settlement";
import type { PredictionBatch } from "@/lib/prediction-log/types";

export async function POST(request: Request) {
  try {
    const batch = (await request.json()) as PredictionBatch;
    if (!batch?.id || !Array.isArray(batch.matches)) {
      return NextResponse.json({ error: "Invalid batch" }, { status: 400 });
    }
    if (!batchAllMatchesRichSettlement(batch)) {
      return NextResponse.json(
        { error: "Batch does not have rich settlement on every match" },
        { status: 400 }
      );
    }

    const { persisted } = await persistRichSettlementBatch(batch);
    return NextResponse.json({ ok: true, persisted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to persist rich settlement";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
