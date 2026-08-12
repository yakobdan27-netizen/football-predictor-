"use client";

import type { PredictionBatch } from "@/lib/prediction-log/types";

type Props = {
  batches: PredictionBatch[];
  value: string;
  onChange: (batchId: string) => void;
  emptyLabel?: string;
  label?: string;
};

/**
 * Shared batch picker for result pages (Combined Odds, Recommendation, etc.).
 */
export function BatchSelect({
  batches,
  value,
  onChange,
  emptyLabel = "No batches",
  label = "Batch",
}: Props) {
  return (
    <label style={{ fontSize: "0.8125rem", fontWeight: 600 }}>
      {label}
      <select
        className="select"
        style={{ display: "block", marginTop: "0.25rem", minWidth: "16rem" }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {batches.length === 0 && <option value="">{emptyLabel}</option>}
        {batches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.batchName} ({b.date}) · {b.matches.length} matches
          </option>
        ))}
      </select>
    </label>
  );
}
