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
                  <div>
                    <span style={{ color: "var(--muted)" }}>System pick: </span>
                    {row.systemPick?.label ?? "—"}
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)" }}>Selected market: </span>
                    {row.selectedMarketLabel}
                    {row.selectedPredictionLabel !== "—" && ` — ${row.selectedPredictionLabel}`}
                    {row.selectedPFinal != null && (
                      <span style={{ fontWeight: 600 }}> — {row.selectedPFinal}%</span>
                    )}
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
