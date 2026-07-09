"use client";

import { useMemo } from "react";
import { evaluateBatchCombos } from "@/lib/prediction-log/combo-selection";
import type { CombinedOddsSettings } from "@/lib/prediction-log/types";
import type { AnalysisHistory, LearnerStatsStore, PredictionBatch } from "@/lib/prediction-log/types";
import type { TeamsQualityStore } from "@/lib/prediction-log/teams-quality-types";

interface ComboAnalysisSectionProps {
  batch: PredictionBatch;
  allBatches: PredictionBatch[];
  comboSettings: CombinedOddsSettings;
  analysis: AnalysisHistory | null;
  teamsQuality?: TeamsQualityStore | null;
  learnerStats?: LearnerStatsStore | null;
  defaultOpen?: boolean;
}

export function ComboAnalysisSection({
  batch,
  allBatches,
  comboSettings,
  analysis,
  teamsQuality,
  learnerStats,
  defaultOpen = false,
}: ComboAnalysisSectionProps) {
  const { matches, accumulator } = useMemo(
    () => evaluateBatchCombos(batch, comboSettings, analysis, allBatches, teamsQuality, learnerStats),
    [batch, comboSettings, analysis, allBatches, teamsQuality, learnerStats]
  );

  return (
    <details open={defaultOpen} style={{ marginTop: "1.25rem" }} id="combo-analysis-section">
      <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.9375rem" }}>
        Combined odds evaluation
      </summary>
      <div style={{ marginTop: "0.75rem" }}>
        <p style={{ fontSize: "0.8125rem", color: "var(--muted)", marginTop: 0 }}>
          Joint probabilities from frozen score grids. Accumulator legs after dynamic drop:{" "}
          <strong>{accumulator.legs.length}</strong>
          {accumulator.droppedCount > 0 ? ` (${accumulator.droppedCount} dropped)` : ""}.
        </p>

        {matches.map((m) => (
          <div
            key={m.matchId}
            className="card"
            style={{ marginBottom: "0.75rem", padding: "0.75rem" }}
          >
            <strong>
              {m.homeTeam} vs {m.awayTeam}
            </strong>
            {!m.hasGrid ? (
              <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: "0.35rem 0 0" }}>
                No score grid — regenerate batch.
              </p>
            ) : (
              <>
                {m.selected ? (
                  <p style={{ fontSize: "0.875rem", margin: "0.35rem 0" }}>
                    Selected: <strong>{m.selected.label}</strong> — P_final {m.selected.pFinal}% (grid{" "}
                    {m.selected.pGrid}%)
                  </p>
                ) : (
                  <p style={{ fontSize: "0.875rem", margin: "0.35rem 0", color: "var(--warn)" }}>
                    No combo cleared tier floor.
                  </p>
                )}
                <table style={{ width: "100%", fontSize: "0.75rem", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                      <th style={{ padding: "0.25rem" }}>Combo</th>
                      <th style={{ padding: "0.25rem" }}>Grid%</th>
                      <th style={{ padding: "0.25rem" }}>P_final%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.allEvaluated.slice(0, 8).map((c) => (
                      <tr
                        key={c.comboId}
                        style={{
                          background:
                            m.selected?.comboId === c.comboId
                              ? "rgba(76, 175, 80, 0.08)"
                              : undefined,
                        }}
                      >
                        <td style={{ padding: "0.25rem" }}>{c.label}</td>
                        <td style={{ padding: "0.25rem" }}>{c.pGrid}</td>
                        <td style={{ padding: "0.25rem" }}>{c.pFinal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        ))}

        {accumulator.droppedLegs.length > 0 && (
          <div style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
            <strong>Dropped from accumulator:</strong>
            <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.25rem" }}>
              {accumulator.droppedLegs.map((leg) => (
                <li key={leg.matchId}>
                  {leg.homeTeam} vs {leg.awayTeam}
                  {leg.selected ? ` — ${leg.selected.label} (${leg.selected.pFinal}%)` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
