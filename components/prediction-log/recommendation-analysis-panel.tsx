"use client";

import {
  buildMatchSummaryRows,
  formatBetterAlternativeLine,
  formatSystemPickLine,
  getBatchDisplayId,
  getMarketComparisonForMatch,
  getMathSnapshot,
  getProfessionalForMatch,
  getProfessionalSummary,
  getSelectedPickForMatch,
  getTierAccentColor,
  tierDisplayLabel,
  valueTierColor,
  valueTierLabel,
} from "@/lib/prediction-log/snapshot-readers";
import { LOG_MARKET_MAP } from "@/lib/prediction-log/markets-config";
import { pickCommentEmoji, pickCommentTitle } from "@/lib/prediction-log/pick-comment";
import { batchRiskBandLabel } from "@/lib/prediction-log/batch-risk-config";
import { CorrectScoreOneLiner } from "./correct-score-panel";
import type { PredictionBatch } from "@/lib/prediction-log/types";

interface RecommendationAnalysisPanelProps {
  batch: PredictionBatch;
  sourceBatch?: PredictionBatch | null;
}

const ACCENT = "#5aa0ff";

/**
 * Full frozen-snapshot workbench for a recommended batch.
 * Reads mathSnapshot only — never recomputes P_final or better alternatives.
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
  const combinedOdds = math?.totalCombinedOdds ?? recommended.summary.totalCombinedOdds;
  const avgConfidence = math?.averagePFinal ?? recommended.summary.averagePFinal ?? null;
  const exclusions = recommended.summary.exclusions ?? [];
  const workflow = math?.workflowLog ?? [];
  const reduction = math?.reductionSteps ?? [];

  return (
    <div id="recommendation-analysis" className="card" style={{ borderColor: accent }}>
      <div style={{ marginBottom: "1rem" }}>
        <div style={{ fontSize: "0.75rem", fontWeight: 700, color: accent }}>
          {tierDisplayLabel(tier)} · Recommendation analysis
        </div>
        <h3 style={{ fontSize: "1.125rem", margin: "0.25rem 0 0" }}>{batchId}</h3>
        <p style={{ margin: "0.35rem 0 0", fontSize: "0.8125rem", color: "var(--muted)" }}>
          {recommended.summary.matchesIncluded} match
          {recommended.summary.matchesIncluded === 1 ? "" : "es"}
          {avgConfidence != null && (
            <>
              {" · "}Avg confidence <strong style={{ color: "inherit" }}>{avgConfidence}%</strong>
            </>
          )}
          {combinedOdds != null && (
            <>
              {" · "}Combined odds{" "}
              <strong style={{ color: "inherit" }}>{combinedOdds.toFixed(2)}</strong>
            </>
          )}
          {sourceBatch && (
            <>
              {" · "}Source: {sourceBatch.batchName}
            </>
          )}
        </p>
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
          All values below are frozen from generation — same snapshot as the Recommendation summary.
        </p>
      </div>

      {/* Batch risk strip */}
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

      {/* Workflow */}
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

      {/* Reduction steps */}
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
                  <tr key={`${step.matchId}-${step.label}`} style={{ borderTop: "1px solid var(--border)" }}>
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
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem", fontSize: "0.75rem", color: "var(--muted)" }}>
            {exclusions.map((ex) => (
              <li key={`${ex.matchId}-${ex.reason}`}>
                {ex.homeTeam} vs {ex.awayTeam} — {ex.reason}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Per-match detail */}
      <section style={{ marginBottom: "1.25rem" }}>
        <h4 style={{ fontSize: "0.9375rem", margin: "0 0 0.75rem" }}>Match breakdown</h4>
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
              const altLine = formatBetterAlternativeLine(row.betterAlternative);
              const comment = row.pickComment;
              const logMatch = batch.matches.find((m) => m.id === row.matchId);
              const csSnapshot = logMatch?.correctScoreSnapshot?.mostLikely;
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

                  <div style={{ fontSize: "0.8125rem", display: "grid", gap: "0.3rem", marginBottom: "0.75rem" }}>
                    <div>
                      <span style={{ color: "var(--muted)" }}>System pick: </span>
                      <strong>{formatSystemPickLine(row.systemPick)}</strong>
                    </div>
                    <div>
                      <span style={{ color: "var(--muted)" }}>Selected market: </span>
                      <strong>
                        {row.selectedMarketLabel}
                        {row.selectedPredictionLabel !== "—"
                          ? ` — ${row.selectedPredictionLabel}`
                          : ""}
                        {pFinal != null ? ` — ${pFinal}%` : ""}
                      </strong>
                    </div>
                    <div>
                      {altLine.isOptimal ? (
                        <span style={{ color: "var(--accent)" }}>{altLine.text}</span>
                      ) : (
                        <>
                          <span style={{ color: "var(--muted)" }}>Better option: </span>
                          <strong style={{ color: "var(--warn)" }}>
                            {altLine.text}
                            {altLine.showArrow ? " ↑" : ""}
                          </strong>
                        </>
                      )}
                    </div>
                    {comment && (
                      <div style={{ color: "var(--muted)" }}>
                        {pickCommentEmoji(comment.label)} {pickCommentTitle(comment.label)} —{" "}
                        {comment.message}
                      </div>
                    )}
                  </div>

                  {/* Math signals */}
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
                      <div style={{ color: "var(--muted)", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
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
                            <span>
                              Capacity {pickMath.signals.capacityEdge}
                            </span>
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

                  {/* Full market comparison */}
                  <div style={{ marginBottom: "0.75rem" }}>
                    <div style={{ fontWeight: 600, fontSize: "0.75rem", marginBottom: "0.35rem" }}>
                      All markets (frozen)
                    </div>
                    {markets.length === 0 ? (
                      <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)" }}>
                        Market comparison not available on this snapshot.
                      </p>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table
                          style={{ width: "100%", fontSize: "0.75rem", borderCollapse: "collapse" }}
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
                                  background: m.selected ? "rgba(90,160,255,0.08)" : undefined,
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

                  {/* Pro read */}
                  {pro && (
                    <div style={{ fontSize: "0.8125rem", marginBottom: "0.5rem" }}>
                      <span style={{ color: "var(--muted)" }}>Pro read: </span>
                      <span style={{ color: valueTierColor(pro.valueTier), fontWeight: 600 }}>
                        {valueTierLabel(pro.valueTier)}
                      </span>
                      {pro.hasPrice && (
                        <span style={{ color: "var(--muted)" }}>
                          {" · "}Edge {pro.edgePct >= 0 ? "+" : ""}
                          {pro.edgePct} pts · EV {pro.evPerUnit >= 0 ? "+" : ""}
                          {(pro.evPerUnit * 100).toFixed(0)}% · Models {pro.agreementLabel}
                        </span>
                      )}
                      <div style={{ color: "var(--muted)", marginTop: "0.15rem" }}>{pro.verdict}</div>
                    </div>
                  )}

                  {/* Correct score */}
                  <div style={{ fontSize: "0.8125rem" }}>
                    <span style={{ color: "var(--muted)" }}>Correct score: </span>
                    {csSnapshot ? (
                      <>
                        <strong>
                          {csSnapshot.home}-{csSnapshot.away} ({csSnapshot.probPct}%)
                        </strong>
                        <CorrectScoreOneLiner snapshot={csSnapshot} />
                      </>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>Not enough data yet.</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Combined slip footer */}
      <div
        style={{
          padding: "0.85rem",
          borderRadius: "8px",
          border: `1px solid ${ACCENT}`,
          background: "rgba(90,160,255,0.06)",
        }}
      >
        <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: ACCENT, marginBottom: "0.5rem" }}>
          BEST COMBINED PREDICTION
        </div>
        {recommended.matches.length === 0 ? (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.8125rem" }}>
            No legs qualified for a combined slip.
          </p>
        ) : (
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.1rem", fontSize: "0.8125rem" }}>
            {recommended.matches.map((rm) => {
              const pick = getSelectedPickForMatch(rm);
              if (!pick) return null;
              const marketLabel = LOG_MARKET_MAP[pick.marketKey]?.label ?? pick.marketKey;
              const oddsLabel = pick.pick.odds != null ? ` @ ${pick.pick.odds.toFixed(2)}` : "";
              return (
                <li key={rm.id} style={{ marginBottom: "0.2rem" }}>
                  {rm.homeTeam} vs {rm.awayTeam}: <strong>{marketLabel}</strong>
                  {oddsLabel}
                </li>
              );
            })}
          </ul>
        )}
        {(() => {
          const slip = getProfessionalSummary(batch);
          if (!slip || slip.comboEvPerUnit == null) return null;
          return (
            <div style={{ fontSize: "0.8125rem" }}>
              <span style={{ color: "var(--muted)" }}>Professional value: </span>
              <strong style={{ color: slip.comboEvPerUnit >= 0 ? "#4fb477" : "var(--warn)" }}>
                Slip EV {slip.comboEvPerUnit >= 0 ? "+" : ""}
                {(slip.comboEvPerUnit * 100).toFixed(0)}%
              </strong>
              <span style={{ color: "var(--muted)" }}>
                {" · "}
                {slip.valueLegs}/{slip.legs} legs with an edge
              </span>
              <div style={{ color: "var(--muted)", marginTop: "0.15rem" }}>{slip.headline}</div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
