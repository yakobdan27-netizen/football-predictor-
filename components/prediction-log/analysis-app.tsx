"use client";

import { getSystematicRules } from "@/lib/prediction-log/odds-recommendations";
import {
  exportCsv,
  exportJson,
  exportOddsAnalysisCsv,
  exportComparisonCsv,
} from "@/lib/prediction-log/export";
import { AnalysisTab } from "./analysis-tab";
import { OddsAnalysisTab } from "./odds-analysis-tab";
import { ClubCapacityBrowser } from "./club-capacity-browser";
import { BatchAnalysisPanel } from "./batch-analysis-panel";
import { StatMatchDiagnostics } from "./stat-match-diagnostics";
import { usePredictionLogData } from "./use-prediction-log-data";

export function AnalysisApp() {
  const {
    ready,
    error,
    batches,
    analysis,
    clubIndex,
    clubProfiles,
    learnerStats,
    teamCharacteristics,
    teamsQuality,
    mlClassifier,
  } = usePredictionLogData();
  const rules = getSystematicRules();

  if (!ready) {
    return <p className="page-sub">Loading stats…</p>;
  }

  const totalWins =
    analysis != null
      ? Object.values(analysis.marketAccuracy).reduce((s, m) => s + (m?.correct ?? 0), 0)
      : 0;
  const totalLosses =
    analysis != null
      ? Object.values(analysis.marketAccuracy).reduce((s, m) => s + (m?.wrong ?? 0), 0)
      : 0;
  const winRate =
    totalWins + totalLosses > 0
      ? Math.round((totalWins / (totalWins + totalLosses)) * 100)
      : null;

  return (
    <div>
      {error && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Export data</h3>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-secondary" onClick={() => exportCsv(batches)}>
          Export CSV
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() =>
            exportJson(batches, analysis, clubProfiles, learnerStats, teamCharacteristics)
          }
        >
          Export JSON
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => exportComparisonCsv(batches)}>
          Export Comparison
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => exportOddsAnalysisCsv(batches)}>
          Export Odds Analysis
        </button>
      </div>

      <StatMatchDiagnostics
        batches={batches}
        analysis={analysis}
        teamsQuality={teamsQuality}
        mlClassifier={mlClassifier}
      />

      <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Overall performance</h3>
      <div className="stat-grid" style={{ marginBottom: "1.5rem" }}>
        <div className="card">
          <div className="stat-value">{analysis?.totalScored ?? 0}</div>
          <div className="stat-label">Total predictions scored</div>
        </div>
        <div className="card">
          <div className="stat-value">{winRate != null ? `${winRate}%` : "—"}</div>
          <div className="stat-label">Win rate</div>
        </div>
        <div className="card">
          <div className="stat-value" style={{ color: "var(--accent)" }}>
            {totalWins}
          </div>
          <div className="stat-label">Wins</div>
        </div>
        <div className="card">
          <div className="stat-value" style={{ color: "var(--danger)" }}>
            {totalLosses}
          </div>
          <div className="stat-label">Losses</div>
        </div>
      </div>

      <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Odds analysis</h3>
      <OddsAnalysisTab analysis={analysis} />

      <h3 style={{ fontSize: "1rem", margin: "1.5rem 0 0.75rem" }}>Prediction-type analysis</h3>
      <AnalysisTab analysis={analysis} />

      <h3 style={{ fontSize: "1rem", margin: "1.5rem 0 0.75rem" }}>Batch analysis</h3>
      <BatchAnalysisPanel batches={batches} />

      <h3 style={{ fontSize: "1rem", margin: "1.5rem 0 0.75rem" }}>Club analysis</h3>
      <ClubCapacityBrowser clubIndex={clubIndex} />

      <h3 style={{ fontSize: "1rem", margin: "1.5rem 0 0.75rem" }}>Systematic judgement</h3>
      <div className="card">
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem", color: "var(--muted)" }}>
          How to judge odds and predictions going forward, based on systematic betting principles
          and your logged history.
        </p>
        <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem" }}>
          {rules.map((rule, i) => (
            <li key={i} style={{ marginBottom: "0.5rem", color: "var(--muted)" }}>
              {rule}
            </li>
          ))}
        </ul>
        {analysis?.calibrationNote && (
          <p
            style={{
              margin: "1rem 0 0",
              fontSize: "0.875rem",
              borderTop: "1px solid var(--border)",
              paddingTop: "0.75rem",
            }}
          >
            {analysis.calibrationNote}
          </p>
        )}
      </div>
    </div>
  );
}
