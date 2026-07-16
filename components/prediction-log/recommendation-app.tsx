"use client";

import { useMemo } from "react";
import Link from "next/link";
import { RecommendationSummaryCard } from "./recommendation-summary-card";
import { usePredictionLogData } from "./use-prediction-log-data";

export function RecommendationApp() {
  const { ready, error, batches } = usePredictionLogData();

  const recommendedBatches = useMemo(
    () =>
      batches
        .filter((b) => b.batchKind === "recommended" && b.recommended)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [batches]
  );

  if (!ready) {
    return <p className="page-sub">Loading…</p>;
  }

  return (
    <div>
      {error && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {recommendedBatches.length === 0 ? (
        <p className="page-sub" style={{ margin: 0 }}>
          No recommendation batches yet. Generate one on the{" "}
          <Link href="/analysis" style={{ color: "var(--accent)" }}>
            Stats
          </Link>{" "}
          page.
        </p>
      ) : (
        <div style={{ display: "grid", gap: "1rem" }}>
          {recommendedBatches.map((batch) => (
            <RecommendationSummaryCard key={batch.id} batch={batch} />
          ))}
        </div>
      )}
    </div>
  );
}
