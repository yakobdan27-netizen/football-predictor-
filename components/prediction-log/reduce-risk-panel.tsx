"use client";

import { batchRiskBandLabel } from "@/lib/prediction-log/batch-risk-config";
import { FORMULA_CONFIG } from "@/lib/prediction-log/master-probability-config";
import type { BatchRiskResult, ReductionStep } from "@/lib/prediction-log/dynamic-batch-risk";

interface ReduceRiskPanelProps {
  risk: BatchRiskResult;
  steps: ReductionStep[];
  removedIds: Set<string>;
  onRemove: (matchId: string) => void;
}

export function ReduceRiskPanel({ risk, steps, removedIds, onRemove }: ReduceRiskPanelProps) {
  const visibleSteps = steps.filter((s) => !removedIds.has(s.matchId));
  const belowFloor =
    risk.batchConfidence != null && risk.batchConfidence < FORMULA_CONFIG.confidenceFloor;

  return (
    <div
      className="card"
      style={{
        marginBottom: "1rem",
        borderColor: risk.band === "high" ? "var(--danger)" : risk.band === "caution" ? "var(--warn)" : undefined,
      }}
    >
      <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Reduce risk</h3>
      {risk.band === "safe" && !belowFloor && (
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--muted)" }}>
          Batch risk is in the safe band. No removals suggested — you can still remove legs manually
          below.
        </p>
      )}
      {risk.band === "caution" && (
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem", color: "var(--warn)" }}>
          Caution band — consider reviewing the weakest legs below.
        </p>
      )}
      {(risk.band === "high" || belowFloor) && (
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem", color: "var(--danger)" }}>
          {risk.band === "high" ? "High risk" : "Low batch confidence"} — removing the weakest
          prediction (lowest P_final) lowers batch risk. You can still save the full batch.
        </p>
      )}

      {visibleSteps.length === 0 ? (
        risk.band !== "safe" && (
          <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--muted)" }}>
            No further automated removal steps — adjust legs manually or save with caution.
          </p>
        )
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {visibleSteps.map((step) => (
            <li
              key={step.matchId}
              style={{
                padding: "0.75rem 0",
                borderTop: "1px solid var(--border)",
                fontSize: "0.875rem",
              }}
            >
              <strong>{step.label}</strong>
              <p style={{ margin: "0.35rem 0", color: "var(--muted)", fontSize: "0.8125rem" }}>
                Removing lowers odds {step.oddsBefore.toFixed(2)} → {step.oddsAfter.toFixed(2)},
                risk {step.riskBefore} → {step.riskAfter} ({batchRiskBandLabel(step.bandAfter)})
                {step.pFinalBefore != null && step.pFinalAfter != null && (
                  <>, batch confidence {step.pFinalBefore}% → {step.pFinalAfter}%</>
                )}
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: "0.8125rem" }}
                onClick={() => onRemove(step.matchId)}
              >
                Remove from batch
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
