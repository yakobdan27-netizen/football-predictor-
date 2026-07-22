import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin/auth";
import { backfillBatchesFromManualResult } from "@/lib/prediction-log/manual-result-apply";
import {
  getManualResult,
  saveManualResult,
} from "@/lib/prediction-log/manual-results-store";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdminRequest(request);
  if (denied) return denied;

  const { id } = await context.params;
  const existing = await getManualResult(id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { batchesUpdated, matchLegsUpdated } =
    await backfillBatchesFromManualResult(existing, {
      includeNewerBatches: true,
    });

  const record = {
    ...existing,
    batchesUpdatedCount: existing.batchesUpdatedCount + batchesUpdated,
    matchLegsUpdatedCount: existing.matchLegsUpdatedCount + matchLegsUpdated,
  };
  await saveManualResult(record);

  return NextResponse.json({
    record,
    batchesUpdated,
    matchLegsUpdated,
  });
}
