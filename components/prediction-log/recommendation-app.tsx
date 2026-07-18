"use client";

import { useMemo } from "react";
import Link from "next/link";
import { RecommendationBatchLayout } from "./recommendation-batch-layout";
import { usePredictionLogData } from "./use-prediction-log-data";

export function RecommendationApp() {
  const { ready, error, batches } = usePredictionLogData();

  const batchById = useMemo(() => {
    const map = new Map(batches.map((b) => [b.id, b]));
    return map;
  }, [batches]);

  const recommendedBatches = useMemo(
    () =>
      batches
        .filter((b) => Boolean(b.recommended))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [batches]
  );

  if (!ready) {
    return <p className="page-sub">Loading…</p>;
  }

  return (
    <div className="reco-page">
      {error && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <div style={{ marginBottom: "1.25rem" }}>
        <h1 className="page-title">Recommendation</h1>
        <p className="page-sub">
          One correct score, one better market, and one best combined prediction per batch —
          advisory only. Recommendations appear automatically when you save a batch.
        </p>
      </div>

      {recommendedBatches.length === 0 ? (
        <p className="page-sub" style={{ margin: 0 }}>
          No recommendations yet. Save a batch in the{" "}
          <Link href="/prediction-log" style={{ color: "var(--accent)" }}>
            Prediction Log
          </Link>{" "}
          — the recommendation is ready as soon as the batch is saved.
        </p>
      ) : (
        <div style={{ display: "grid", gap: "1.5rem" }}>
          {recommendedBatches.map((batch) => (
            <div key={batch.id} style={{ display: "grid", gap: "0.5rem" }}>
              <RecommendationBatchLayout
                batch={batch}
                sourceBatch={
                  batch.sourceBatchId ? batchById.get(batch.sourceBatchId) ?? null : null
                }
              />
              <Link
                href={`/analysis?batch=${encodeURIComponent(batch.recommendationId ?? batch.id)}`}
                className="reco-analysis-link"
              >
                Open full analysis (grids & Bayesian detail) →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
