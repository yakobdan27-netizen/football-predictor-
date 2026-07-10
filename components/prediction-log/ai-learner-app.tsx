"use client";

import { useMemo } from "react";
import { computeLearnerPatterns, overallWinRate, totalMatchesInBatches, totalSavedBatches } from "@/lib/prediction-log/learner-patterns";
import { buildGlobalCalibrationReport } from "@/lib/prediction-log/global-calibration";
import { LearnerAdvicePanel } from "./learner-advice-panel";
import { LearnedPatternsPanel } from "./learned-patterns-panel";
import { ClubCapacityBrowser } from "./club-capacity-browser";
import { CalibrationDashboard } from "./calibration-dashboard";
import { MarketReliabilityBoard } from "./market-reliability-board";
import { usePredictionLogData } from "./use-prediction-log-data";

export function AiLearnerApp() {
  const {
    ready,
    error,
    batches,
    analysis,
    learnerStats,
    teamCharacteristics,
    clubIndex,
    luckyNumbers,
    learnerEnabled,
    setLearner,
    refresh,
  } = usePredictionLogData();

  const patterns = useMemo(() => {
    if (!learnerStats || !teamCharacteristics) return null;
    return computeLearnerPatterns(
      batches,
      analysis,
      learnerStats,
      teamCharacteristics,
      luckyNumbers?.numbers ?? []
    );
  }, [batches, analysis, learnerStats, teamCharacteristics, luckyNumbers]);

  const calibrationReport = useMemo(
    () => buildGlobalCalibrationReport(batches),
    [batches]
  );

  if (!ready || !learnerStats) {
    return <p className="page-sub">Loading learner data…</p>;
  }

  const winRate = overallWinRate(learnerStats);

  async function exportClubs() {
    const res = await fetch("/api/clubs/export");
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `club-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {error && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <div
        className="card"
        style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={learnerEnabled}
            onChange={(e) => setLearner(e.target.checked)}
          />
          AI Learner active for recommendations
        </label>
        <button type="button" className="btn btn-secondary" style={{ fontSize: "0.8125rem" }} onClick={() => void refresh()}>
          Refresh
        </button>
        <button type="button" className="btn btn-secondary" style={{ fontSize: "0.8125rem" }} onClick={() => void exportClubs()}>
          Download all club data (JSON)
        </button>
      </div>

      <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Learning summary</h3>
      <div className="stat-grid" style={{ marginBottom: "1rem" }}>
        <div className="card">
          <div className="stat-value">{totalSavedBatches(batches)}</div>
          <div className="stat-label">Batches saved</div>
        </div>
        <div className="card">
          <div className="stat-value">{totalMatchesInBatches(batches)}</div>
          <div className="stat-label">Total matches</div>
        </div>
        <div className="card">
          <div className="stat-value">{winRate != null ? `${winRate}%` : "—"}</div>
          <div className="stat-label">Overall win rate</div>
        </div>
        <div className="card">
          <div className="stat-value" style={{ fontSize: "1rem", color: learnerEnabled ? "var(--accent)" : "var(--muted)" }}>
            {learnerEnabled ? "Active" : "Off"}
          </div>
          <div className="stat-label">Learning status</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem", fontSize: "0.8125rem", color: "var(--muted)" }}>
        <strong style={{ color: "inherit" }}>Update log</strong>
        <p style={{ margin: "0.35rem 0 0" }}>
          Learner last updated: {new Date(learnerStats.updatedAt).toLocaleString()}
        </p>
        {clubIndex && (
          <p style={{ margin: "0.25rem 0 0" }}>
            Club index last updated: {new Date(clubIndex.updatedAt).toLocaleString()} (
            {clubIndex.clubs.length} clubs)
          </p>
        )}
      </div>

      <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Support for your next prediction</h3>
      <LearnerAdvicePanel stats={learnerStats} enabled={learnerEnabled} />

      <CalibrationDashboard report={calibrationReport} />

      {analysis ? (
        <MarketReliabilityBoard
          top={analysis.topMarkets ?? []}
          weakest={analysis.weakestMarkets ?? []}
        />
      ) : null}

      {learnerStats.comboTypeStats && Object.keys(learnerStats.comboTypeStats).length > 0 && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Combo type accuracy</h3>
          <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem" }}>
            {Object.entries(learnerStats.comboTypeStats)
              .filter(([, s]) => s.wins + s.losses >= 3)
              .sort((a, b) => (b[1].winRate ?? 0) - (a[1].winRate ?? 0))
              .slice(0, 10)
              .map(([id, s]) => (
                <li key={id}>
                  {id.replace(/_/g, " ")}: {s.winRate}% ({s.wins}W / {s.losses}L)
                </li>
              ))}
          </ul>
        </div>
      )}

      {patterns && <LearnedPatternsPanel patterns={patterns} />}

      <h3 style={{ fontSize: "1rem", margin: "1.5rem 0 0.75rem" }}>Club capacities and histories</h3>
      <ClubCapacityBrowser clubIndex={clubIndex} />
    </div>
  );
}
