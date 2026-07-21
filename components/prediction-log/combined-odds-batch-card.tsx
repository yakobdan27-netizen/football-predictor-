"use client";

import Link from "next/link";
import type { ComboAccumulatorResult, MatchComboResult } from "@/lib/prediction-log/combo-selection";
import { getBatchDisplayId, getTierAccentColor, hasExtendedSnapshot } from "@/lib/prediction-log/snapshot-readers";
import type { PredictionBatch, RecommendationTier } from "@/lib/prediction-log/types";
import { CombinedOddsMatchCard } from "./combined-odds-match-card";

interface CombinedOddsBatchCardProps {
  batch: PredictionBatch;
  tier: RecommendationTier;
  matches: MatchComboResult[];
  accumulator: ComboAccumulatorResult;
  onComboOddsChange?: (matchId: string, odds: number | "") => void;
}

const TIER_LABELS = {
  safe: "Extreme Safe",
  balanced: "Balanced",
  aggressive: "Aggressive",
} as const;

export function CombinedOddsBatchCard({
  batch,
  tier,
  matches,
  accumulator,
  onComboOddsChange,
}: CombinedOddsBatchCardProps) {
  const recommended = batch.recommended;
  if (!recommended || matches.length === 0) return null;

  const accentColor = getTierAccentColor(tier);
  const batchId = getBatchDisplayId(batch);
  const extended = hasExtendedSnapshot(batch);
  const gridsReady = matches.some((m) => m.hasGrid);
  const title =
    recommended.displayName ||
    batch.batchName ||
    (batch.batchKind === "recommended" ? "Recommended" : "Batch combos");

  const statusLabel =
    accumulator.status === "safe"
      ? `SAFE for ${TIER_LABELS[tier]} tier ✓`
      : accumulator.status === "below_floor"
        ? `Below ${TIER_LABELS[tier]} floor`
        : "Insufficient legs for accumulator";

  return (
    <div className="card" style={{ borderColor: accentColor, marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "0.75rem", fontWeight: 700, color: accentColor, marginBottom: "0.25rem" }}>
            {title}
          </div>
          <h3 style={{ fontSize: "1.125rem", margin: 0 }}>{batchId}</h3>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
            {matches.length} match{matches.length === 1 ? "" : "es"}
            {batch.batchKind ? ` · ${batch.batchKind}` : ""}
          </p>
        </div>
        <Link
          href={`/analysis?batch=${encodeURIComponent(batch.id)}`}
          style={{ fontSize: "0.875rem", fontWeight: 600, color: accentColor, alignSelf: "flex-start" }}
        >
          View analysis →
        </Link>
      </div>

      {!extended && !gridsReady && (
        <p style={{ margin: "0.75rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
          Score grids are still preparing (or unavailable for some fixtures). Combos use seed priors when
          club history is thin.
        </p>
      )}

      <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
        {matches.map((m) => (
          <CombinedOddsMatchCard
            key={m.matchId}
            batch={batch}
            match={m}
            accentColor={accentColor}
            comboOdds={batch.recommended?.comboOddsByMatch?.[m.matchId]}
            onOddsChange={onComboOddsChange}
          />
        ))}
      </div>

      <div
        style={{
          marginTop: "1rem",
          padding: "0.75rem",
          borderRadius: "6px",
          border: `1px solid ${accentColor}`,
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "0.875rem", marginBottom: "0.5rem" }}>
          BATCH COMBINED ACCUMULATOR
        </div>
        <div style={{ fontSize: "0.875rem", display: "grid", gap: "0.25rem" }}>
          <div>
            Legs: <strong>{accumulator.legs.length}</strong>
            {accumulator.combinedProbability != null && (
              <>
                {" · "}
                Combined probability: <strong>{accumulator.combinedProbability}%</strong>
              </>
            )}
          </div>
          {accumulator.combinedOdds != null && (
            <div>
              Combined odds: <strong>{accumulator.combinedOdds.toFixed(2)}</strong>
            </div>
          )}
          {accumulator.riskAdjustedConfidence != null && (
            <div>
              Batch risk-adjusted confidence: <strong>{accumulator.riskAdjustedConfidence}%</strong>
            </div>
          )}
          <div>
            Status: <strong style={{ color: accumulator.status === "safe" ? accentColor : "var(--warn)" }}>{statusLabel}</strong>
          </div>
          {accumulator.droppedCount > 0 && (
            <div style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
              {accumulator.droppedCount} leg{accumulator.droppedCount === 1 ? "" : "s"} dropped for safety — see
              Stat page
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
