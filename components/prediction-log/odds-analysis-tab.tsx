"use client";

import { useState } from "react";
import { ODDS_BAND_IDS, ODDS_BAND_LABELS } from "@/lib/prediction-log/odds-bands";
import type { AnalysisHistory, OddsBandStats } from "@/lib/prediction-log/types";

interface OddsAnalysisTabProps {
  analysis: AnalysisHistory | null;
}

function BandBar({ stats }: { stats: OddsBandStats }) {
  const denom = stats.wins + stats.losses;
  const pct = stats.winRate ?? 0;

  return (
    <div style={{ marginBottom: "1rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.875rem",
          marginBottom: "0.25rem",
          flexWrap: "wrap",
          gap: "0.25rem",
        }}
      >
        <span>
          {ODDS_BAND_LABELS[stats.band]}
          {stats.lowSample && denom > 0 && (
            <span style={{ color: "var(--warn)", marginLeft: "0.35rem", fontSize: "0.75rem" }}>
              low sample
            </span>
          )}
        </span>
        <span style={{ color: "var(--muted)" }}>
          {stats.winRate != null ? `${stats.winRate}%` : "—"} ({stats.wins}W / {stats.losses}L
          {stats.pushes > 0 ? ` / ${stats.pushes}P` : ""})
        </span>
      </div>
      <div
        style={{
          height: "8px",
          background: "var(--surface2)",
          borderRadius: "4px",
          overflow: "hidden",
        }}
      >
        {denom > 0 && (
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background:
                pct >= 55 ? "var(--accent)" : pct >= 45 ? "var(--warn)" : "var(--danger)",
              borderRadius: "4px",
            }}
          />
        )}
      </div>
      <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
        Total: {stats.total}
        {stats.avgWinOdds != null && ` · Avg win odds: ${stats.avgWinOdds}`}
        {stats.avgLossOdds != null && ` · Avg loss odds: ${stats.avgLossOdds}`}
        {stats.valueScore != null && !stats.lowSample && ` · Value: ${stats.valueScore}`}
      </div>
    </div>
  );
}

export function OddsAnalysisTab({ analysis }: OddsAnalysisTabProps) {
  const [mode, setMode] = useState<"all" | "recent">("all");

  if (!analysis || analysis.totalScored === 0) {
    return (
      <p className="page-sub">
        Odds analysis appears after you save batches with odds and enter results.
      </p>
    );
  }

  const oa = analysis.oddsAnalysis;
  const bands =
    mode === "recent" ? oa.recentBands : oa.bands;
  const hasOddsData = ODDS_BAND_IDS.some((b) => bands[b].total > 0);

  if (!hasOddsData) {
    return (
      <p className="page-sub">
        No picks with odds recorded yet. Add odds (1.00–3.00) when creating batches.
      </p>
    );
  }

  return (
    <div>
      <div className="chip-scroll" style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          className={`chip${mode === "all" ? " selected" : ""}`}
          onClick={() => setMode("all")}
        >
          All-time
        </button>
        <button
          type="button"
          className={`chip${mode === "recent" ? " selected" : ""}`}
          onClick={() => setMode("recent")}
        >
          Recent (30)
        </button>
      </div>

      {(oa.mostWonBand || oa.mostLostBand || oa.bestValueBand) && mode === "all" && (
        <div className="card" style={{ marginBottom: "1rem", fontSize: "0.875rem" }}>
          {oa.mostWonBand && (
            <p style={{ margin: "0 0 0.35rem" }}>
              Most won band: <strong>{ODDS_BAND_LABELS[oa.mostWonBand]}</strong> (
              {oa.bands[oa.mostWonBand].winRate}%)
            </p>
          )}
          {oa.mostLostBand && oa.mostLostBand !== oa.mostWonBand && (
            <p style={{ margin: "0 0 0.35rem" }}>
              Most lost band: <strong>{ODDS_BAND_LABELS[oa.mostLostBand]}</strong> (
              {oa.bands[oa.mostLostBand].winRate}%)
            </p>
          )}
          {oa.bestValueBand && (
            <p style={{ margin: 0 }}>
              Best value band: <strong>{ODDS_BAND_LABELS[oa.bestValueBand]}</strong> (score{" "}
              {oa.bands[oa.bestValueBand].valueScore})
            </p>
          )}
        </div>
      )}

      <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Win rate by odds band</h3>
      {ODDS_BAND_IDS.map((b) =>
        bands[b].total > 0 ? <BandBar key={b} stats={bands[b]} /> : null
      )}
    </div>
  );
}
