"use client";

import Link from "next/link";
import {
  buildMatchSummaryRows,
  formatBetterAlternativeLine,
  formatSystemPickLine,
  getBatchDisplayId,
  getMathSnapshot,
  getTierAccentColor,
  tierDisplayLabel,
} from "@/lib/prediction-log/snapshot-readers";
import type { PredictionBatch } from "@/lib/prediction-log/types";

interface RecommendationSummaryCardProps {
  batch: PredictionBatch;
}

/**
 * Betting-slip style summary: frozen snapshot fields only — no formulas or workflow.
 */
export function RecommendationSummaryCard({ batch }: RecommendationSummaryCardProps) {
  const recommended = batch.recommended;
  if (!recommended) return null;

  const math = getMathSnapshot(batch);
  const batchId = getBatchDisplayId(batch);
  const matchRows = buildMatchSummaryRows(batch, recommended);
  const displayCount = recommended.summary.matchesIncluded;
  const combinedOdds = math?.totalCombinedOdds ?? recommended.summary.totalCombinedOdds;
  const avgConfidence = math?.averagePFinal ?? recommended.summary.averagePFinal ?? null;
  const tier = batch.recommendationTier ?? recommended.tier;
  const accent = getTierAccentColor(tier);

  return (
    <div className="card" style={{ borderColor: accent }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              color: accent,
              marginBottom: "0.25rem",
            }}
          >
            {tierDisplayLabel(tier)}
            {recommended.displayName ? ` · ${recommended.displayName}` : ""}
          </div>
          <h3 style={{ fontSize: "1.125rem", margin: 0 }}>{batchId}</h3>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.8125rem", color: "var(--muted)" }}>
            {displayCount} match{displayCount === 1 ? "" : "es"}
            {avgConfidence != null && (
              <>
                {" · "}Avg confidence{" "}
                <strong style={{ color: "inherit" }}>{avgConfidence}%</strong>
              </>
            )}
            {combinedOdds != null && (
              <>
                {" · "}Combined odds{" "}
                <strong style={{ color: "inherit" }}>{combinedOdds.toFixed(2)}</strong>
              </>
            )}
          </p>
        </div>
        <Link
          href={`/analysis?batch=${encodeURIComponent(batchId)}`}
          style={{
            fontSize: "0.875rem",
            fontWeight: 600,
            color: accent,
            alignSelf: "flex-start",
            whiteSpace: "nowrap",
          }}
        >
          View analysis →
        </Link>
      </div>

      <div style={{ marginTop: "1rem", display: "grid", gap: "0.65rem" }}>
        {matchRows.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.875rem" }}>
            No matches qualified for this recommendation.
          </p>
        ) : (
          matchRows.map((row) => {
            const altLine = formatBetterAlternativeLine(row.betterAlternative);
            return (
              <div
                key={row.matchId}
                style={{
                  padding: "0.65rem 0.75rem",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.01)",
                  fontSize: "0.875rem",
                }}
              >
                <strong style={{ display: "block", marginBottom: "0.4rem" }}>
                  {row.homeTeam} vs {row.awayTeam}
                </strong>
                <div style={{ display: "grid", gap: "0.25rem", color: "var(--muted)" }}>
                  <div>
                    System pick:{" "}
                    <strong style={{ color: "var(--text)" }}>
                      {formatSystemPickLine(row.systemPick)}
                    </strong>
                  </div>
                  <div>
                    Selected market:{" "}
                    <strong style={{ color: "var(--text)" }}>
                      {row.selectedMarketLabel}
                      {row.selectedPredictionLabel !== "—"
                        ? ` — ${row.selectedPredictionLabel}`
                        : ""}
                      {row.selectedPFinal != null ? ` — ${row.selectedPFinal}%` : ""}
                    </strong>
                  </div>
                  <div>
                    {altLine.isOptimal ? (
                      <span style={{ color: "var(--accent)" }}>{altLine.text}</span>
                    ) : (
                      <>
                        Better option:{" "}
                        <strong style={{ color: "var(--warn)" }}>
                          {altLine.text}
                          {altLine.showArrow ? " ↑" : ""}
                        </strong>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
