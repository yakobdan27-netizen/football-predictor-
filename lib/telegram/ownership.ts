import { loadAllBatches, loadBatch } from "@/lib/prediction-log/club-store";
import type { PredictionBatch } from "@/lib/prediction-log/types";
import { getUserBatchIds } from "./user-store";

export class OwnershipError extends Error {
  status = 403;
  constructor(message = "Batch does not belong to this user") {
    super(message);
    this.name = "OwnershipError";
  }
}

export function assertBatchOwnedBy(
  batch: PredictionBatch | null | undefined,
  ownerUserId: string
): asserts batch is PredictionBatch {
  if (!batch) {
    const err = new Error("Batch not found");
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
  if (batch.ownerUserId !== ownerUserId) {
    throw new OwnershipError();
  }
}

export async function listBatchesForUser(ownerUserId: string): Promise<PredictionBatch[]> {
  const indexed = await getUserBatchIds(ownerUserId);
  if (indexed.length) {
    const out: PredictionBatch[] = [];
    for (const id of indexed) {
      const b = await loadBatch(id);
      if (b && b.ownerUserId === ownerUserId) out.push(b);
    }
    return out.sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.date.localeCompare(a.date)
    );
  }

  // Fallback: scan all (legacy before index backfill)
  const all = await loadAllBatches();
  return all
    .filter((b) => b.ownerUserId === ownerUserId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.date.localeCompare(a.date));
}

export async function getOwnedBatch(
  batchId: string,
  ownerUserId: string
): Promise<PredictionBatch> {
  const batch = await loadBatch(batchId);
  assertBatchOwnedBy(batch, ownerUserId);
  return batch;
}
