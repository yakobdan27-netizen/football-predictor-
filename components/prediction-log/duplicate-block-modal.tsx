"use client";

import type { DuplicateHit } from "@/lib/prediction-log/cross-batch-duplicate-check";

interface DuplicateBlockModalProps {
  duplicates: DuplicateHit[];
  onCancel: () => void;
  onViewBatch: (batchId: string) => void;
}

export function DuplicateBlockModal({
  duplicates,
  onCancel,
  onViewBatch,
}: DuplicateBlockModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dup-block-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
      onClick={onCancel}
    >
      <div
        className="card"
        style={{
          maxWidth: 520,
          width: "100%",
          margin: 0,
          padding: 0,
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            background: "var(--danger)",
            color: "#fff",
            padding: "1rem 1.1rem",
          }}
        >
          <h3 id="dup-block-title" style={{ margin: 0, fontSize: "1.1rem" }}>
            Duplicate prediction detected
          </h3>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.875rem", opacity: 0.95 }}>
            This match + market + prediction already exists in another batch on the same date.
            Save is blocked to prevent double exposure.
          </p>
        </div>

        <div style={{ padding: "1rem", display: "grid", gap: "0.75rem", maxHeight: "50vh", overflowY: "auto" }}>
          {duplicates.map((dup, idx) => (
            <div
              key={`${dup.batchId}-${idx}`}
              style={{
                border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)",
                background: "color-mix(in srgb, var(--danger) 8%, transparent)",
                borderRadius: 8,
                padding: "0.75rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "0.5rem",
                  alignItems: "flex-start",
                  marginBottom: "0.5rem",
                }}
              >
                <strong style={{ fontSize: "0.9rem" }}>
                  {dup.homeTeam} vs {dup.awayTeam}
                </strong>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onViewBatch(dup.batchId)}
                  style={{ flexShrink: 0 }}
                >
                  View batch
                </button>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "0.35rem 0.75rem",
                  fontSize: "0.85rem",
                }}
              >
                <div>
                  <span style={{ opacity: 0.7 }}>Batch: </span>
                  <span>{dup.batchName}</span>
                </div>
                <div>
                  <span style={{ opacity: 0.7 }}>Date: </span>
                  <span>{dup.matchDate}</span>
                </div>
                <div>
                  <span style={{ opacity: 0.7 }}>Market: </span>
                  <span>{dup.marketLabel}</span>
                </div>
                <div>
                  <span style={{ opacity: 0.7 }}>Prediction: </span>
                  <span style={{ color: "var(--danger)", fontWeight: 600 }}>
                    {dup.prediction}
                    {dup.line != null ? ` @ ${dup.line}` : ""}
                  </span>
                </div>
                {dup.odds != null ? (
                  <div>
                    <span style={{ opacity: 0.7 }}>Odds: </span>
                    <span>{dup.odds}</span>
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.85 }}>
            Delete or change the existing prediction first, then save this batch.
          </p>
        </div>

        <div
          style={{
            borderTop: "1px solid var(--border, #333)",
            padding: "0.85rem 1rem",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
