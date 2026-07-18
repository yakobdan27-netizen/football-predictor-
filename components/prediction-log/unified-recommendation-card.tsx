"use client";

import { RecommendationBatchLayout } from "./recommendation-batch-layout";
import type { PredictionBatch } from "@/lib/prediction-log/types";

interface UnifiedRecommendationCardProps {
  batch: PredictionBatch;
  /** The user-filled batch this recommendation was generated from. */
  sourceBatch?: PredictionBatch | null;
}

/** Layout-only wrapper — same table language as Result-Filling / Saved Batch. */
export function UnifiedRecommendationCard({
  batch,
  sourceBatch,
}: UnifiedRecommendationCardProps) {
  return <RecommendationBatchLayout batch={batch} sourceBatch={sourceBatch} />;
}
