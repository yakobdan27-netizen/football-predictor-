"use client";

import Link from "next/link";
import {
  buildMatchSummaryRows,
  formatBetterAlternativeLine,
  getBatchDisplayId,
  getMathSnapshot,
  getTierAccentColor,
  hasExtendedSnapshot,
} from "@/lib/prediction-log/snapshot-readers";
import {
  pickCommentEmoji,
  pickCommentTitle,
} from "@/lib/prediction-log/pick-comment";
import { loadRecommendationSettings } from "@/lib/prediction-log/storage";
import { suggestStake } from "@/lib/prediction-log/strategy-rules";
import { CorrectScoreOneLiner } from "./correct-score-panel";
import type { PredictionBatch } from "@/lib/prediction-log/types";

interface RecommendationBatchSummaryCardProps {
  batch: PredictionBatch;
}

export function RecommendationBatchSummaryCard({ batch }: RecommendationBatchSummaryCardProps) {
  const recommended = batch.recommended;
  if (!recommended) return null;

  const math = getMathSnapshot(batch);
  const accentColor = getTierAccentColor(batch.recommendationTier);
  const batchId = getBatchDisplayId(batch);
  const matchRows = buildMatchSummaryRows(batch, recommended);
  const displayCount = recommended.summary.matchesIncluded;
  const displayOdds = math?.totalCombinedOdds ?? recommended.summary.totalCombinedOdds;
  const batchConfidence = math?.averagePFinal ?? recommended.summary.averagePFinal ?? null;
  const extended = hasExtendedSnapshot(batch);
  const bs = loadRecommendationSettings().bankrollStrategy;
  const tierStake = suggestStake({
    settings: bs,
    pSignal: batchConfidence,
    odds: null,
    tier: batch.recommendationTier ?? "balanced",
  });

  return (
    <div className="card" style={{ borderColor: accentColor }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "0.75rem", fontWeight: 700, color: accentColor, marginBottom: "0.25rem" }}>
            {recommended.displayName}
          </div>
          <h3 style={{ fontSize: "1.125rem", margin: 0 }}>{batchId}</h3>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.8125rem", color: "var(--muted)" }}>
            {displayCount} match{displayCount === 1 ? "" : "es"}
            {batchConfidence != null && (
              <>
                {" · "}
                Avg confidence <strong style={{ color: "inherit" }}>{batchConfidence}%</strong>
              </>
            )}
            {displayOdds != null && (
              <>
                {" · "}
                Combined odds <strong style={{ color: "inherit" }}>{displayOdds.toFixed(2)}</strong>
              </>
            )}
            {tierStake.suggested != null && (
              <>
                {" · "}
                Suggested stake{" "}
                <strong style={{ color: "inherit" }}>{tierStake.suggested}</strong>
                <span title={tierStake.reason}>
                  {" "}
                  ({batch.recommendationTier ?? "balanced"} tier)
                </span>
              </>
            )}
          </p>
        </div>
        <Link
          href={`/analysis?batch=${encodeURIComponent(batch.id)}`}
          style={{
            fontSize: "0.875rem",
            fontWeight: 600,
            color: accentColor,
            alignSelf: "flex-start",
            whiteSpace: "nowrap",
          }}
        >
          View analysis →
        </Link>
      </div>

      {!extended && (
        <p style={{ margin: "0.75rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
          Regenerate this batch to populate system picks and alternative market comparisons.
        </p>
      )}

      <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
        {matchRows.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>No matches in batch.</p>
        ) : (
          matchRows.map((row) => {
            const altLine = formatBetterAlternativeLine(row.betterAlternative);
            const logMatch = batch.matches.find((m) => m.id === row.matchId);
            const csSnapshot = logMatch?.correctScoreSnapshot?.mostLikely;
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
              <div
                key={row.matchId}
                style={{
                  padding: "0.75rem",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.01)",
                }}
              >
                <strong style={{ display: "block", marginBottom: "0.5rem" }}>
                  {row.homeTeam} vs {row.awayTeam}
                </strong>
                <div style={{ fontSize: "0.875rem", display: "grid", gap: "0.25rem" }}>
                  {comment ? (
                    <div style={{ color: commentColor, fontWeight: 600 }}>
                      {pickCommentEmoji(comment.label)} {pickCommentTitle(comment.label)}
                      <span style={{ fontWeight: 400, color: "var(--muted)", marginLeft: "0.35rem" }}>
                        — {comment.message}
                      </span>
                    </div>
                  ) : null}
                  <div>
                    <span style={{ color: "var(--muted)" }}>System pick: </span>
                    {row.systemPick?.label ?? "—"}
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)" }}>Selected market: </span>
                    {row.selectedMarketLabel}
                    {row.selectedPredictionLabel !== "—" && ` — ${row.selectedPredictionLabel}`}
                    {row.selectedPFinal != null && (
                      <span
                        style={{ fontWeight: 600 }}
                        title={row.confidenceSource ?? undefined}
                      >
                        {" "}
                        — {row.selectedPFinal}%
                      </span>
                    )}
                    {row.confidenceSource ? (
                      <span
                        title={row.confidenceSource}
                        style={{
                          marginLeft: "0.35rem",
                          fontSize: "0.75rem",
                          color: "var(--muted)",
                          cursor: "help",
                          borderBottom: "1px dotted var(--muted)",
                        }}
                      >
                        why?
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)" }}>Better option: </span>
                    <span style={{ color: altLine.isOptimal ? "var(--accent)" : "var(--warn)" }}>
                      {altLine.text}
                      {altLine.showArrow ? " ↑" : ""}
                    </span>
                  </div>
                </div>
                <CorrectScoreOneLiner snapshot={csSnapshot} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
