"use client";

import Link from "next/link";
import type { MatchComboResult } from "@/lib/prediction-log/combo-selection";
import type { PredictionBatch } from "@/lib/prediction-log/types";

interface CombinedOddsMatchCardProps {
  batch: PredictionBatch;
  match: MatchComboResult;
  accentColor: string;
  comboOdds?: number | null;
  onOddsChange?: (matchId: string, odds: number | "") => void;
}

export function CombinedOddsMatchCard({
  batch,
  match,
  accentColor,
  comboOdds,
  onOddsChange,
}: CombinedOddsMatchCardProps) {
  const selected = match.selected;

  return (
    <div
      style={{
        padding: "0.75rem",
        borderRadius: "6px",
        border: "1px solid var(--border)",
        background: "rgba(255,255,255,0.01)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
        <strong>
          {match.homeTeam} vs {match.awayTeam}
        </strong>
        <Link
          href={`/analysis?batch=${encodeURIComponent(batch.id)}`}
          style={{ fontSize: "0.8125rem", fontWeight: 600, color: accentColor }}
        >
          View analysis →
        </Link>
      </div>

      {!match.hasGrid ? (
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "var(--muted)" }}>
          Regenerate batch to populate score grid.
        </p>
      ) : selected ? (
        <div style={{ marginTop: "0.5rem", fontSize: "0.875rem", display: "grid", gap: "0.25rem" }}>
          <div>
            <span style={{ color: "var(--muted)" }}>COMBO: </span>
            <strong>{selected.label}</strong>
          </div>
          <div>
            <span style={{ color: "var(--muted)" }}>Probability: </span>
            <strong>{selected.pFinal}%</strong>
            <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
              {" "}
              (grid {selected.pGrid}%)
            </span>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ fontSize: "0.8125rem", display: "flex", gap: "0.35rem", alignItems: "center" }}>
              <span style={{ color: "var(--muted)" }}>Odds:</span>
              <input
                className="input"
                type="number"
                min={1.01}
                step={0.01}
                style={{ width: "80px", padding: "0.25rem 0.5rem" }}
                value={comboOdds ?? selected.odds ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  onOddsChange?.(match.matchId, v === "" ? "" : parseFloat(v));
                }}
              />
            </label>
            {selected.value != null ? (
              <span>
                <span style={{ color: "var(--muted)" }}>Value: </span>
                <strong style={{ color: selected.value > 0 ? "var(--accent)" : "var(--danger)" }}>
                  {selected.value > 0 ? "+" : ""}
                  {selected.value.toFixed(2)}
                </strong>
              </span>
            ) : null}
          </div>
          {match.alternative ? (
            <div style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
              Alt combo: {match.alternative.label} ({match.alternative.pFinal}%)
              <span style={{ color: "var(--warn)", marginLeft: "0.25rem" }}>↑</span>
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ marginTop: "0.5rem", fontSize: "0.875rem" }}>
          <p style={{ margin: "0 0 0.35rem", color: "var(--warn)" }}>
            No safe combo — use single market
          </p>
          {match.fallbackSingle ? (
            <p style={{ margin: 0, color: "var(--muted)" }}>
              Single pick: {match.fallbackSingle.marketLabel} — {match.fallbackSingle.predictionLabel}{" "}
              ({match.fallbackSingle.pFinal}%)
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
