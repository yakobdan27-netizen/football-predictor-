"use client";

import { batchRiskBandLabel } from "@/lib/prediction-log/batch-risk-config";
import {
  confidenceBand,
  confidenceBandLabel,
  CONFIDENCE_BAND_COLORS,
} from "@/lib/prediction-log/master-probability-config";
import type { BatchRiskResult } from "@/lib/prediction-log/dynamic-batch-risk";

const BAND_COLORS = {
  safe: "var(--accent)",
  caution: "var(--warn)",
  high: "var(--danger)",
} as const;

interface BatchRiskHeaderProps {
  risk: BatchRiskResult;
}

export function BatchRiskHeader({ risk }: BatchRiskHeaderProps) {
  const confBand = risk.batchConfidence != null ? confidenceBand(risk.batchConfidence) : null;

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <div className="stat-grid">
        <div>
          <div className="stat-label">Total batch odds</div>
          <div className="stat-value" style={{ fontSize: "1.25rem" }}>
            {risk.totalOdds?.toFixed(2) ?? "—"}
          </div>
        </div>
        {risk.batchConfidence != null && (
          <div>
            <div className="stat-label">Batch confidence</div>
            <div
              className="stat-value"
              style={{
                fontSize: "1.25rem",
                color: confBand ? CONFIDENCE_BAND_COLORS[confBand] : undefined,
              }}
            >
              {risk.batchConfidence}%{" "}
              <span style={{ fontSize: "0.75rem", textTransform: "uppercase" }}>
                {confBand ? confidenceBandLabel(confBand) : ""}
              </span>
            </div>
          </div>
        )}
        <div>
          <div className="stat-label">Batch risk score</div>
          <div
            className="stat-value"
            style={{ fontSize: "1.25rem", color: BAND_COLORS[risk.band] }}
          >
            {risk.score}
          </div>
        </div>
        <div>
          <div className="stat-label">Risk band</div>
          <div
            className="stat-value"
            style={{
              fontSize: "1rem",
              color: BAND_COLORS[risk.band],
              textTransform: "uppercase",
            }}
          >
            {batchRiskBandLabel(risk.band)}
          </div>
        </div>
      </div>
      <p style={{ margin: "0.75rem 0 0", fontSize: "0.8125rem", color: "var(--muted)" }}>
        {risk.explanation}
      </p>
      <p style={{ margin: "0.35rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
        R_odds {(risk.rOdds * 100).toFixed(0)}% · R_loss {(risk.rLoss * 100).toFixed(0)}% · R_batch{" "}
        {(risk.rBatch * 100).toFixed(0)}%
        {risk.weakTypeFactor > 0 ? ` · Weak markets +${risk.weakTypeFactor}` : ""}
      </p>
    </div>
  );
}
