"use client";

import { analyzeAllBatches } from "@/lib/prediction-log/batch-analysis";
import type { PredictionBatch } from "@/lib/prediction-log/types";

interface BatchAnalysisPanelProps {
  batches: PredictionBatch[];
}

export function BatchAnalysisPanel({ batches }: BatchAnalysisPanelProps) {
  const rows = analyzeAllBatches(batches);

  if (rows.length === 0) {
    return (
      <p className="page-sub">
        Batch analysis appears after you enter results on saved batches.
      </p>
    );
  }

  const won = rows.filter((r) => r.batchWon === true).length;
  const lost = rows.filter((r) => r.batchWon === false).length;

  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: "1rem" }}>
        <div className="card">
          <div className="stat-value">{rows.length}</div>
          <div className="stat-label">Scored batches</div>
        </div>
        <div className="card">
          <div className="stat-value" style={{ color: "var(--accent)" }}>{won}</div>
          <div className="stat-label">Batches won</div>
        </div>
        <div className="card">
          <div className="stat-value" style={{ color: "var(--danger)" }}>{lost}</div>
          <div className="stat-label">Batches lost</div>
        </div>
      </div>

      {rows.map((row) => (
        <div key={row.batchId} className="card" style={{ marginBottom: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
            <strong>{row.batchName}</strong>
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 700,
                color:
                  row.batchWon === true
                    ? "var(--accent)"
                    : row.batchWon === false
                      ? "var(--danger)"
                      : "var(--muted)",
              }}
            >
              {row.batchWon === true ? "WON" : row.batchWon === false ? "LOST" : "PARTIAL"}
            </span>
          </div>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.8125rem", color: "var(--muted)" }}>
            {row.date} · {row.league} · {row.legsCorrect}/{row.legsScored} legs correct
          </p>

          {row.breakingLeg && (
            <div
              style={{
                marginTop: "0.5rem",
                padding: "0.5rem 0.75rem",
                background: "rgba(244, 67, 54, 0.08)",
                borderRadius: "6px",
                fontSize: "0.8125rem",
              }}
            >
              <strong>Broke the batch:</strong> {row.breakingLeg.homeTeam} vs {row.breakingLeg.awayTeam}{" "}
              — {row.breakingLeg.marketLabel} ({row.breakingLeg.prediction})
              {row.breakingLeg.odds != null && ` @ ${row.breakingLeg.odds.toFixed(2)}`}
            </div>
          )}

          {row.batchWon === true && (
            <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "var(--accent)" }}>
              All {row.legsScored} scored legs were correct.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
