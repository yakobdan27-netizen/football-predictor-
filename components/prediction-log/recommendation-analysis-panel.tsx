"use client";

import {
  buildMatchSummaryRows,
  getBatchDisplayId,
  getMarketComparisonForMatch,
  getMathSnapshot,
  getProfessionalForMatch,
  getSelectedPickForMatch,
  getTierAccentColor,
  tierDisplayLabel,
  valueTierColor,
  valueTierLabel,
} from "@/lib/prediction-log/snapshot-readers";
import { batchRiskBandLabel } from "@/lib/prediction-log/batch-risk-config";
import { UnifiedRecommendationCard } from "./unified-recommendation-card";
import type { PredictionBatch } from "@/lib/prediction-log/types";

interface RecommendationAnalysisPanelProps {
  batch: PredictionBatch;
  sourceBatch?: PredictionBatch | null;
}

/**
 * Analysis workbench: unified advisory panel + frozen math/workflow detail.
 * Does not duplicate the recommendation outputs (those live in UnifiedRecommendationCard).
 */
export function RecommendationAnalysisPanel({
  batch,
  sourceBatch,
}: RecommendationAnalysisPanelProps) {
  const recommended = batch.recommended;
  if (!recommended) {
    return (
      <div className="card">
        <p style={{ margin: 0, color: "var(--muted)" }}>
          This batch has no recommendation snapshot.
        </p>
      </div>
    );
  }

  const math = getMathSnapshot(batch);
  const batchId = getBatchDisplayId(batch);
  const matchRows = buildMatchSummaryRows(batch, recommended);
  const tier = batch.recommendationTier ?? recommended.tier;
  const accent = getTierAccentColor(tier);
  const exclusions = recommended.summary.exclusions ?? [];
  const workflow = math?.workflowLog ?? [];
  const reduction = math?.reductionSteps ?? [];

  return (
    <div id="recommendation-analysis" style={{ display: "grid", gap: "1rem" }}>
      <UnifiedRecommendationCard batch={batch} sourceBatch={sourceBatch} />

      <div className="card" style={{ borderColor: accent }}>
        <div style={{ marginBottom: "1rem" }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 700, color: accent }}>
            {tierDisplayLabel(tier)} · Math & workflow detail
          </div>
          <h3 style={{ fontSize: "1.125rem", margin: "0.25rem 0 0" }}>{batchId}</h3>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
            Frozen snapshot only — same Batch ID as the recommendation panel above. Advisory; never
            blocks a bet.
          </p>
        </div>

        {math && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: "0.75rem",
              marginBottom: "1.25rem",
              padding: "0.75rem",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              fontSize: "0.8125rem",
            }}
          >
            <div>
              <div style={{ color: "var(--muted)" }}>Batch risk</div>
              <strong>
                {math.batchRiskScore} · {batchRiskBandLabel(math.batchRiskBand)}
              </strong>
            </div>
            <div>
              <div style={{ color: "var(--muted)" }}>R_odds / R_loss / R_batch</div>
              <strong>
                {(math.rOdds * 100).toFixed(0)}% / {(math.rLoss * 100).toFixed(0)}% /{" "}
                {(math.rBatch * 100).toFixed(0)}%
              </strong>
            </div>
            {math.lambda != null && (
              <div>
                <div style={{ color: "var(--muted)" }}>λ (brake)</div>
                <strong>{math.lambda.toFixed(3)}</strong>
              </div>
            )}
          </div>
        )}

        <section style={{ marginBottom: "1.25rem" }}>
          <h4 style={{ fontSize: "0.9375rem", margin: "0 0 0.5rem" }}>Generation workflow</h4>
          {workflow.length === 0 ? (
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--muted)" }}>
              No workflow log on this snapshot (older batch).
            </p>
          ) : (
            <ol
              style={{
                margin: 0,
                paddingLeft: "1.25rem",
                fontSize: "0.8125rem",
                color: "var(--muted)",
              }}
            >
              {workflow.map((step, i) => (
                <li key={`${step.phase}-${i}`} style={{ marginBottom: "0.35rem" }}>
                  <strong style={{ color: "var(--text)" }}>{step.phase}</strong> — {step.message}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section style={{ marginBottom: "1.25rem" }}>
          <h4 style={{ fontSize: "0.9375rem", margin: "0 0 0.5rem" }}>Weakest-link reduction</h4>
          {reduction.length === 0 ? (
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--muted)" }}>
              No reduction steps recorded.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: "0.75rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                    <th style={{ padding: "0.35rem" }}>Removed</th>
                    <th style={{ padding: "0.35rem" }}>Odds</th>
                    <th style={{ padding: "0.35rem" }}>Risk</th>
                    <th style={{ padding: "0.35rem" }}>P_final</th>
                    <th style={{ padding: "0.35rem" }}>Band</th>
                  </tr>
                </thead>
                <tbody>
                  {reduction.map((step) => (
                    <tr
                      key={`${step.matchId}-${step.label}`}
                      style={{ borderTop: "1px solid var(--border)" }}
                    >
                      <td style={{ padding: "0.35rem" }}>{step.label}</td>
                      <td style={{ padding: "0.35rem" }}>
                        {step.oddsBefore.toFixed(2)} → {step.oddsAfter.toFixed(2)}
                      </td>
                      <td style={{ padding: "0.35rem" }}>
                        {step.riskBefore} → {step.riskAfter}
                      </td>
                      <td style={{ padding: "0.35rem" }}>
                        {step.pFinalBefore ?? "—"} → {step.pFinalAfter ?? "—"}
                      </td>
                      <td style={{ padding: "0.35rem" }}>{batchRiskBandLabel(step.bandAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {exclusions.length > 0 && (
            <ul
              style={{
                margin: "0.5rem 0 0",
                paddingLeft: "1.1rem",
                fontSize: "0.75rem",
                color: "var(--muted)",
              }}
            >
              {exclusions.map((ex) => (
                <li key={`${ex.matchId}-${ex.reason}`}>
                  {ex.homeTeam} vs {ex.awayTeam} — {ex.reason}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4 style={{ fontSize: "0.9375rem", margin: "0 0 0.75rem" }}>
            Market grids & Bayesian signals
          </h4>
          {matchRows.length === 0 ? (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.8125rem" }}>
              No matches in this recommendation.
            </p>
          ) : (
            <div style={{ display: "grid", gap: "1rem" }}>
              {matchRows.map((row) => {
                const rm = recommended.matches.find((m) => m.id === row.matchId);
                const selected = rm ? getSelectedPickForMatch(rm) : null;
                const pickMath = selected?.pick.mathSnapshot ?? null;
                const markets = getMarketComparisonForMatch(batch, row.matchId);
                const pro = getProfessionalForMatch(batch, row.matchId);
                const pSignal =
                  selected?.pick.pSignal ??
                  pickMath?.pSignal ??
                  math?.pFinalBaseByMatch?.[row.matchId] ??
                  null;
                const pFinal =
                  row.selectedPFinal ??
                  selected?.pick.pFinal ??
                  math?.pFinalByMatch?.[row.matchId] ??
                  null;

                return (
                  <div
                    key={row.matchId}
                    style={{
                      padding: "0.85rem",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      background: "rgba(255,255,255,0.01)",
                    }}
                  >
                    <strong style={{ display: "block", marginBottom: "0.5rem" }}>
                      {row.homeTeam} vs {row.awayTeam}
                    </strong>

                    {(pickMath || pSignal != null || pFinal != null) && (
                      <div
                        style={{
                          marginBottom: "0.75rem",
                          padding: "0.5rem",
                          borderRadius: "4px",
                          border: "1px dashed var(--border)",
                          fontSize: "0.75rem",
                        }}
                      >
                        <div style={{ fontWeight: 600, marginBottom: "0.35rem" }}>Math breakdown</div>
                        <div
                          style={{
                            color: "var(--muted)",
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "0.75rem",
                          }}
                        >
                          {pSignal != null && (
                            <span>
                              P_signal <strong style={{ color: "var(--text)" }}>{pSignal}%</strong>
                            </span>
                          )}
                          {pFinal != null && (
                            <span>
                              P_final <strong style={{ color: "var(--text)" }}>{pFinal}%</strong>
                            </span>
                          )}
                          {pickMath && (
                            <>
                              <span>Capacity {pickMath.signals.capacityEdge}</span>
                              <span>Form {pickMath.signals.recentForm}</span>
                              <span>H2H {pickMath.signals.headToHead}</span>
                              <span>Accuracy {pickMath.signals.yourAccuracy}</span>
                              {pickMath.statLayer && (
                                <>
                                  <span>P_dc {pickMath.statLayer.pDc}</span>
                                  <span>P_ml {pickMath.statLayer.pMl}</span>
                                  <span>P_stat {pickMath.statLayer.pStat}</span>
                                  {pickMath.statLayer.bayesianLayer && (
                                    <span>
                                      Bayes {pickMath.statLayer.bayesianLayer.pMarket}% [
                                      {pickMath.statLayer.bayesianLayer.pLo}–
                                      {pickMath.statLayer.bayesianLayer.pHi}]
                                    </span>
                                  )}
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    <div style={{ marginBottom: "0.75rem" }}>
                      <div
                        style={{ fontWeight: 600, fontSize: "0.75rem", marginBottom: "0.35rem" }}
                      >
                        All markets (frozen)
                      </div>
                      {markets.length === 0 ? (
                        <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)" }}>
                          Market comparison not available on this snapshot.
                        </p>
                      ) : (
                        <div style={{ overflowX: "auto" }}>
                          <table
                            style={{
                              width: "100%",
                              fontSize: "0.75rem",
                              borderCollapse: "collapse",
                            }}
                          >
                            <thead>
                              <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                                <th style={{ padding: "0.3rem" }}>Market</th>
                                <th style={{ padding: "0.3rem" }}>Pick</th>
                                <th style={{ padding: "0.3rem" }}>P_final</th>
                                <th style={{ padding: "0.3rem" }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {markets.map((m) => (
                                <tr
                                  key={`${m.marketKey}-${m.predictionLabel}`}
                                  style={{
                                    borderTop: "1px solid var(--border)",
                                    background: m.selected
                                      ? "rgba(90,160,255,0.08)"
                                      : undefined,
                                  }}
                                >
                                  <td style={{ padding: "0.3rem" }}>{m.marketLabel}</td>
                                  <td style={{ padding: "0.3rem" }}>{m.predictionLabel}</td>
                                  <td style={{ padding: "0.3rem" }}>{m.pFinal}%</td>
                                  <td style={{ padding: "0.3rem", color: "var(--accent)" }}>
                                    {m.selected ? "selected" : ""}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {pro && (
                      <div style={{ fontSize: "0.8125rem" }}>
                        <span style={{ color: "var(--muted)" }}>Pro read: </span>
                        <span
                          style={{ color: valueTierColor(pro.valueTier), fontWeight: 600 }}
                        >
                          {valueTierLabel(pro.valueTier)}
                        </span>
                        {pro.hasPrice && (
                          <span style={{ color: "var(--muted)" }}>
                            {" · "}Edge {pro.edgePct >= 0 ? "+" : ""}
                            {pro.edgePct} pts · EV {pro.evPerUnit >= 0 ? "+" : ""}
                            {(pro.evPerUnit * 100).toFixed(0)}% · Models {pro.agreementLabel}
                          </span>
                        )}
                        <div style={{ color: "var(--muted)", marginTop: "0.15rem" }}>
                          {pro.verdict}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
