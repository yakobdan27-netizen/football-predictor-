"use client";

import type { PredictionBatch } from "@/lib/prediction-log/types";
import type { FixtureSource } from "./use-analysis-fixture-batch";

type Props = {
  fixtureSource: FixtureSource;
  onSourceChange: (source: FixtureSource) => void;
  batchId: string;
  onBatchIdChange: (id: string) => void;
  sortedBatches: PredictionBatch[];
  onRefresh?: () => void;
  refreshing?: boolean;
  onExpandedReset?: () => void;
};

export function AnalysisFixtureSourceControls({
  fixtureSource,
  onSourceChange,
  batchId,
  onBatchIdChange,
  sortedBatches,
  onRefresh,
  refreshing,
  onExpandedReset,
}: Props) {
  return (
    <>
      <label style={{ fontSize: "0.8125rem", fontWeight: 600 }}>
        Fixture source
        <select
          className="select"
          style={{ display: "block", marginTop: "0.25rem", minWidth: "14rem" }}
          value={fixtureSource}
          onChange={(e) => {
            onSourceChange(e.target.value as FixtureSource);
            onExpandedReset?.();
          }}
        >
          <option value="weekend">Weekend Picks (API)</option>
          <option value="saved">Saved batch</option>
        </select>
      </label>
      {fixtureSource === "saved" ? (
        <label style={{ fontSize: "0.8125rem", fontWeight: 600 }}>
          Batch
          <select
            className="select"
            style={{ display: "block", marginTop: "0.25rem", minWidth: "16rem" }}
            value={batchId}
            onChange={(e) => {
              onBatchIdChange(e.target.value);
              onExpandedReset?.();
            }}
          >
            {sortedBatches.length === 0 && <option value="">No batches</option>}
            {sortedBatches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.batchName} ({b.date}) · {b.matches.length} matches
              </option>
            ))}
          </select>
        </label>
      ) : (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={refreshing}
          onClick={() => onRefresh?.()}
        >
          {refreshing ? "Refreshing…" : "Refresh from API"}
        </button>
      )}
    </>
  );
}
