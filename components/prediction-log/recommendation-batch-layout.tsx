"use client";

import { useState, type CSSProperties } from "react";
import {
  buildMatchSummaryRows,
  displayConfidenceLabel,
  formatBetterAlternativeLine,
  getBatchDisplayId,
  getMathSnapshot,
  getProfessionalSummary,
  getSelectedPickForMatch,
  mapBatchRiskToDisplayConfidence,
  mapConfidenceBandToDisplay,
  type RecoDisplayConfidence,
} from "@/lib/prediction-log/snapshot-readers";
import { LOG_MARKET_MAP } from "@/lib/prediction-log/markets-config";
import { deriveActualsFromFacts } from "@/lib/prediction-log/grade-from-facts";
import { pickCommentEmoji, pickCommentTitle } from "@/lib/prediction-log/pick-comment";
import { scoreMarket } from "@/lib/prediction-log/score-market";
import { CorrectScoreOneLiner } from "./correct-score-panel";
import type { LogMarketKey, LogMatch, PredictionBatch, ScoreResult } from "@/lib/prediction-log/types";

interface RecommendationBatchLayoutProps {
  batch: PredictionBatch;
  /** The user-filled batch this recommendation was generated from (when batchKind is recommended). */
  sourceBatch?: PredictionBatch | null;
}

function confidenceBadgeStyle(c: RecoDisplayConfidence): CSSProperties {
  switch (c) {
    case "high":
      return { background: "rgba(34, 197, 94, 0.2)", color: "#15803d" };
    case "medium":
      return { background: "rgba(245, 158, 11, 0.2)", color: "#b45309" };
    default:
      return { background: "var(--surface2)", color: "var(--muted)" };
  }
}

function resultScoreLabel(match: LogMatch | undefined): string {
  const h = match?.teamStats?.home?.goals;
  const a = match?.teamStats?.away?.goals;
  if (h == null || a == null || !Number.isFinite(h) || !Number.isFinite(a)) return "";
  return `${h}–${a}`;
}

function statusFromScore(result: ScoreResult | undefined | null): {
  icon: string;
  label: string;
  kind: "hit" | "miss" | "push" | "pending";
} {
  if (result === "correct") return { icon: "✓", label: "hit", kind: "hit" };
  if (result === "wrong") return { icon: "✗", label: "miss", kind: "miss" };
  if (result === "push") return { icon: "P", label: "push", kind: "push" };
  if (result === "void") return { icon: "—", label: "void", kind: "pending" };
  return { icon: "—", label: "pending", kind: "pending" };
}

/** Display-only: use stored grade, else scoreMarket once FT facts exist. */
function resolvePickStatus(
  match: LogMatch | undefined,
  marketKey: LogMarketKey | undefined,
  prediction: string | undefined,
  line: number | undefined
): ReturnType<typeof statusFromScore> {
  if (!match || !marketKey || !prediction) return statusFromScore(null);
  const stored = match.scored?.[marketKey];
  if (stored) return statusFromScore(stored);
  const actual =
    match.actualResults?.[marketKey]?.actual ??
    deriveActualsFromFacts(match)[marketKey]?.actual;
  if (actual == null) return statusFromScore(null);
  return statusFromScore(scoreMarket(marketKey, prediction, line, actual));
}

function resolveResultMatch(
  matchId: string,
  batch: PredictionBatch,
  sourceBatch?: PredictionBatch | null
): LogMatch | undefined {
  const fromBatch = batch.matches.find((m) => m.id === matchId);
  const fromSource = sourceBatch?.matches.find((m) => m.id === matchId);
  // Prefer the match that already has FT goals (scraped / entered).
  const batchHasFt =
    fromBatch?.teamStats?.home?.goals != null && fromBatch?.teamStats?.away?.goals != null;
  const sourceHasFt =
    fromSource?.teamStats?.home?.goals != null && fromSource?.teamStats?.away?.goals != null;
  if (sourceHasFt) return fromSource;
  if (batchHasFt) return fromBatch;
  return fromSource ?? fromBatch;
}

function betterMarketCell(
  row: ReturnType<typeof buildMatchSummaryRows>[number],
  selectedLabel: string
): string {
  const altLine = formatBetterAlternativeLine(row.betterAlternative);
  if (altLine.isOptimal) {
    return selectedLabel !== "—" ? selectedLabel : "Optimal pick";
  }
  if (altLine.text !== "—") return altLine.text;
  return selectedLabel;
}

export function RecommendationBatchLayout({
  batch,
  sourceBatch,
}: RecommendationBatchLayoutProps) {
  const recommended = batch.recommended;
  if (!recommended) return null;

  const math = getMathSnapshot(batch);
  const batchId = getBatchDisplayId(batch);
  const matchRows = buildMatchSummaryRows(batch, recommended);
  const displayCount = recommended.summary.matchesIncluded;
  const combinedOdds = math?.totalCombinedOdds ?? recommended.summary.totalCombinedOdds;
  const combinedConfidence = math?.averagePFinal ?? recommended.summary.averagePFinal ?? null;
  const batchConfidence = mapBatchRiskToDisplayConfidence(
    math?.batchRiskBand,
    combinedConfidence
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="reco-batch">
      <div className="card reco-batch-header">
        <div className="reco-batch-header-main">
          <div className="reco-batch-eyebrow">{recommended.displayName}</div>
          <h3 className="reco-batch-title">{batch.batchName || batchId}</h3>
          <p className="reco-batch-meta">
            <span>{batch.date}</span>
            <span aria-hidden> · </span>
            <span>
              {displayCount} match{displayCount === 1 ? "" : "es"}
            </span>
            <span aria-hidden> · </span>
            <span className="reco-batch-id">{batchId}</span>
          </p>
        </div>
        <span className="badge reco-conf-badge" style={confidenceBadgeStyle(batchConfidence)}>
          {displayConfidenceLabel(batchConfidence)}
        </span>
      </div>

      <p className="reco-advisory">
        Guidance only — every match stays in your slip. Nothing here blocks a bet.
      </p>

      {matchRows.length === 0 ? (
        <p className="page-sub" style={{ margin: 0 }}>
          No matches qualified for this recommendation.
        </p>
      ) : (
        <>
          <div className="reco-table-wrap batch-table-wrap">
            <table className="batch-table reco-table">
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Correct Score</th>
                  <th>Better Market</th>
                  <th>Confidence</th>
                  <th>Result</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {matchRows.map((row) => {
                  const rm = recommended.matches.find((m) => m.id === row.matchId)!;
                  const selected = getSelectedPickForMatch(rm);
                  const resultMatch = resolveResultMatch(row.matchId, batch, sourceBatch);
                  const snapshotMatch =
                    batch.matches.find((m) => m.id === row.matchId) ?? resultMatch;
                  const cs = snapshotMatch?.correctScoreSnapshot?.mostLikely;
                  const csLabel = cs ? `${cs.home}–${cs.away}` : "—";
                  const selectedLabel =
                    row.selectedMarketLabel !== "—"
                      ? `${row.selectedMarketLabel} — ${row.selectedPredictionLabel}`
                      : "—";
                  const marketLabel = betterMarketCell(row, selectedLabel);
                  const conf = mapConfidenceBandToDisplay(
                    selected?.pick.confidenceBand,
                    selected?.pick.hybridConfidence ?? row.selectedPFinal
                  );
                  const hybridLabel =
                    selected?.pick.hybridConfidence != null
                      ? `${selected.pick.hybridConfidence}% hybrid`
                      : null;
                  const status = resolvePickStatus(
                    resultMatch,
                    selected?.marketKey,
                    selected?.pick.prediction,
                    selected?.pick.line
                  );
                  const ft = resultScoreLabel(resultMatch);
                  const league = resultMatch?.league ?? snapshotMatch?.league ?? batch.league;
                  const expanded = expandedId === row.matchId;

                  return (
                    <tr
                      key={row.matchId}
                      className={
                        status.kind === "hit"
                          ? "batch-row-correct"
                          : status.kind === "miss"
                            ? "batch-row-wrong"
                            : undefined
                      }
                      onClick={() =>
                        setExpandedId((id) => (id === row.matchId ? null : row.matchId))
                      }
                    >
                      <td>
                        <div className="reco-match-cell">
                          <strong>
                            {row.homeTeam} vs {row.awayTeam}
                          </strong>
                          {league ? <span className="reco-league-tag">{league}</span> : null}
                        </div>
                        {expanded && (
                          <div className="reco-row-expand reco-row-expand-desktop">
                            <ExpandReasoning row={row} cs={cs} />
                          </div>
                        )}
                      </td>
                      <td>{csLabel}</td>
                      <td className="reco-market-cell">{marketLabel}</td>
                      <td>
                        <span
                          className="badge reco-conf-badge"
                          style={confidenceBadgeStyle(conf)}
                          title={
                            selected?.pick.aiLearnerScore != null &&
                            selected?.pick.systemCalculationScore != null
                              ? `AI: ${Math.round(selected.pick.aiLearnerScore * 0.5 * 10) / 10}% | System: ${Math.round(selected.pick.systemCalculationScore * 0.5 * 10) / 10}%`
                              : "Hybrid confidence = AI 50% + system 50%"
                          }
                        >
                          {hybridLabel ?? displayConfidenceLabel(conf)}
                        </span>
                      </td>
                      <td>{ft || "—"}</td>
                      <td>
                        <span className={`reco-status reco-status-${status.kind}`}>
                          {status.icon}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="reco-mobile-cards">
            {matchRows.map((row) => {
              const rm = recommended.matches.find((m) => m.id === row.matchId)!;
              const selected = getSelectedPickForMatch(rm);
              const resultMatch = resolveResultMatch(row.matchId, batch, sourceBatch);
              const snapshotMatch =
                batch.matches.find((m) => m.id === row.matchId) ?? resultMatch;
              const cs = snapshotMatch?.correctScoreSnapshot?.mostLikely;
              const csLabel = cs ? `${cs.home}–${cs.away}` : "—";
              const selectedLabel =
                row.selectedMarketLabel !== "—"
                  ? `${row.selectedMarketLabel} — ${row.selectedPredictionLabel}`
                  : "—";
              const marketLabel = betterMarketCell(row, selectedLabel);
              const conf = mapConfidenceBandToDisplay(
                selected?.pick.confidenceBand,
                selected?.pick.hybridConfidence ?? row.selectedPFinal
              );
              const hybridLabel =
                selected?.pick.hybridConfidence != null
                  ? `${selected.pick.hybridConfidence}% hybrid`
                  : null;
              const status = resolvePickStatus(
                resultMatch,
                selected?.marketKey,
                selected?.pick.prediction,
                selected?.pick.line
              );
              const ft = resultScoreLabel(resultMatch);
              const league = resultMatch?.league ?? snapshotMatch?.league ?? batch.league;
              const expanded = expandedId === row.matchId;

              return (
                <button
                  key={row.matchId}
                  type="button"
                  className={`reco-match-card card${expanded ? " reco-match-card-open" : ""}`}
                  onClick={() =>
                    setExpandedId((id) => (id === row.matchId ? null : row.matchId))
                  }
                >
                  <div className="reco-match-card-top">
                    <div>
                      <strong>
                        {row.homeTeam} vs {row.awayTeam}
                      </strong>
                      {league ? <span className="reco-league-tag">{league}</span> : null}
                    </div>
                    <div className="reco-match-card-badges">
                      <span
                        className="badge reco-conf-badge"
                        style={confidenceBadgeStyle(conf)}
                        title={
                          selected?.pick.aiLearnerScore != null &&
                          selected?.pick.systemCalculationScore != null
                            ? `AI: ${Math.round(selected.pick.aiLearnerScore * 0.5 * 10) / 10}% | System: ${Math.round(selected.pick.systemCalculationScore * 0.5 * 10) / 10}%`
                            : "Hybrid confidence = AI 50% + system 50%"
                        }
                      >
                        {hybridLabel ?? displayConfidenceLabel(conf)}
                      </span>
                      <span className={`reco-status reco-status-${status.kind}`}>
                        {status.icon}
                      </span>
                    </div>
                  </div>
                  <div className="reco-match-card-lines">
                    <div className="reco-kv">
                      <span>Correct Score</span>
                      <span>{csLabel}</span>
                    </div>
                    <div className="reco-kv">
                      <span>Better Market</span>
                      <span>{marketLabel}</span>
                    </div>
                    <div className="reco-kv">
                      <span>Result</span>
                      <span>{ft || "—"}</span>
                    </div>
                    <div className="reco-kv">
                      <span>Status</span>
                      <span className={`reco-status reco-status-${status.kind}`}>
                        {status.icon} {status.label}
                      </span>
                    </div>
                  </div>
                  {expanded && (
                    <div className="reco-row-expand">
                      <ExpandReasoning row={row} cs={cs} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="card reco-best-pick">
        <div className="reco-best-pick-title">BEST COMBINED PREDICTION</div>
        {recommended.matches.length === 0 ? (
          <p className="reco-best-pick-empty">No legs qualified for a combined slip.</p>
        ) : (
          <ul className="reco-best-pick-legs">
            {recommended.matches.map((rm) => {
              const pick = getSelectedPickForMatch(rm);
              if (!pick) return null;
              const marketLabel = LOG_MARKET_MAP[pick.marketKey]?.label ?? pick.marketKey;
              const oddsLabel = pick.pick.odds != null ? ` @ ${pick.pick.odds.toFixed(2)}` : "";
              return (
                <li key={rm.id}>
                  {rm.homeTeam} vs {rm.awayTeam}: <strong>{marketLabel}</strong>
                  {oddsLabel}
                </li>
              );
            })}
          </ul>
        )}
        <div className="reco-best-pick-meta">
          {combinedConfidence != null && (
            <span>
              Combined confidence: <strong>{combinedConfidence}%</strong>
              {"  ·  "}
            </span>
          )}
          {combinedOdds != null && (
            <span>
              Combined odds: <strong>{combinedOdds.toFixed(2)}</strong>
            </span>
          )}
        </div>
        {(() => {
          const slip = getProfessionalSummary(batch);
          if (!slip || slip.comboEvPerUnit == null) return null;
          return (
            <div className="reco-best-pick-pro">
              Slip EV {slip.comboEvPerUnit >= 0 ? "+" : ""}
              {(slip.comboEvPerUnit * 100).toFixed(0)}% · {slip.valueLegs}/{slip.legs} legs with an
              edge
              {slip.headline ? <div>{slip.headline}</div> : null}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function ExpandReasoning({
  row,
  cs,
}: {
  row: ReturnType<typeof buildMatchSummaryRows>[number];
  cs: { home: number; away: number; probPct: number } | undefined;
}) {
  const comment = row.pickComment;
  const commentColor =
    comment?.label === "good"
      ? "var(--accent)"
      : comment?.label === "risky"
        ? "var(--warn)"
        : comment?.label === "avoid"
          ? "var(--danger)"
          : "var(--muted)";

  return (
    <div className="reco-reasoning">
      {comment ? (
        <div style={{ color: commentColor }}>
          {pickCommentEmoji(comment.label)} {pickCommentTitle(comment.label)}
          <span style={{ fontWeight: 400, color: "var(--muted)", marginLeft: "0.35rem" }}>
            — {comment.message}
          </span>
        </div>
      ) : (
        <div style={{ color: "var(--muted)" }}>No extra reasoning stored for this pick.</div>
      )}
      {cs ? <CorrectScoreOneLiner snapshot={cs} /> : null}
    </div>
  );
}
