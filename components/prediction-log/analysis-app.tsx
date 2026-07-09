"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSystematicRules } from "@/lib/prediction-log/odds-recommendations";
import { LEAGUE_OPTIONS } from "@/lib/prediction-log/markets-config";
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
import { RecommendationPanel } from "./recommendation-panel";
import { BatchAnalysisDetail } from "./batch-analysis-detail";
import { StatMatchDiagnostics } from "./stat-match-diagnostics";
import { usePredictionLogData } from "./use-prediction-log-data";

function mostUsedLeague(batches: { league: string }[]): string {
  if (batches.length === 0) return LEAGUE_OPTIONS[0];
  const counts = new Map<string, number>();
  for (const b of batches) {
    counts.set(b.league, (counts.get(b.league) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? LEAGUE_OPTIONS[0];
}

export function AnalysisApp() {
  const searchParams = useSearchParams();
  const {
    ready,
    error,
    batches,
    analysis,
    clubIndex,
    clubProfiles,
    learnerStats,
    teamCharacteristics,
    learnerEnabled,
    teamsQuality,
    mlClassifier,
    comboSettings,
  } = usePredictionLogData();
  const rules = getSystematicRules();

  const defaultLeague = useMemo(() => mostUsedLeague(batches), [batches]);
  const [tipsLeague, setTipsLeague] = useState(defaultLeague);
  const [selectedBatchId, setSelectedBatchId] = useState("");

  useEffect(() => {
    setTipsLeague(defaultLeague);
  }, [defaultLeague]);

  useEffect(() => {
    const fromUrl = searchParams.get("batch");
    if (fromUrl && batches.some((b) => b.id === fromUrl)) {
      setSelectedBatchId(fromUrl);
    } else if (!selectedBatchId && batches.length > 0) {
      setSelectedBatchId(batches[0].id);
    }
  }, [searchParams, batches, selectedBatchId]);

  const urlBatchId = searchParams.get("batch");
  const highlightCombos = searchParams.get("section") === "combos";
  const urlBatchMissing = Boolean(urlBatchId && batches.length > 0 && !batches.some((b) => b.id === urlBatchId));

  useEffect(() => {
    if (urlBatchId && batches.some((b) => b.id === urlBatchId)) {
      const el = document.getElementById("batch-analysis-detail");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [urlBatchId, batches, selectedBatchId]);

  const selectedBatch = batches.find((b) => b.id === selectedBatchId) ?? null;
  const sourceBatch =
    selectedBatch?.sourceBatchId != null
      ? (batches.find((b) => b.id === selectedBatch.sourceBatchId) ?? null)
      : null;
  const isRecommendedBatch = selectedBatch?.batchKind === "recommended";

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

      <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Tips while logging</h3>
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <label className="label">League</label>
        <select
          className="select"
          value={tipsLeague}
          onChange={(e) => setTipsLeague(e.target.value)}
          style={{ marginBottom: "0.75rem", maxWidth: "280px" }}
        >
          {LEAGUE_OPTIONS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <RecommendationPanel league={tipsLeague} analysis={analysis} />
      </div>

      {urlBatchMissing && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          Batch <strong>{urlBatchId}</strong> was not found. Select another batch below.
        </div>
      )}

      <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Recommendation analysis</h3>
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        {batches.length === 0 ? (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.875rem" }}>
            No saved batches yet.{" "}
            <Link href="/prediction-log" style={{ color: "var(--accent)" }}>
              Create a batch
            </Link>{" "}
            or{" "}
            <Link href="/recommendation" style={{ color: "var(--accent)" }}>
              generate recommendations
            </Link>
            .
          </p>
        ) : (
          <>
            <label className="label">Batch</label>
            <select
              className="select"
              value={selectedBatchId}
              onChange={(e) => setSelectedBatchId(e.target.value)}
              style={{ marginBottom: "1rem", maxWidth: "100%" }}
            >
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchKind === "recommended" ? "★ " : ""}
                  {b.batchName} — {b.date} ({b.league})
                </option>
              ))}
            </select>
            {isRecommendedBatch && selectedBatch ? (
              <BatchAnalysisDetail
                batch={selectedBatch}
                sourceBatch={sourceBatch}
                learnerEnabled={learnerEnabled}
                highlightCombos={highlightCombos}
                allBatches={batches}
                comboSettings={comboSettings}
                analysis={analysis}
                teamsQuality={teamsQuality}
                learnerStats={learnerStats}
              />
            ) : selectedBatch?.recommended ? (
              <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.875rem" }}>
                This manual batch has an embedded recommendation snapshot. Generate tier batches on the{" "}
                <Link href="/recommendation" style={{ color: "var(--accent)" }}>
                  Recommendation
                </Link>{" "}
                page for full workflow analysis.
              </p>
            ) : selectedBatch ? (
              <p style={{ margin: 0, color: "var(--warn)", fontSize: "0.875rem" }}>
                No recommendation snapshot for this batch. Use live diagnostics below or generate on{" "}
                <Link href="/recommendation" style={{ color: "var(--accent)" }}>
                  Recommendation
                </Link>
                .
              </p>
            ) : null}
          </>
        )}
      </div>

      {!isRecommendedBatch && (
        <StatMatchDiagnostics
          batches={batches}
          analysis={analysis}
          teamsQuality={teamsQuality}
          mlClassifier={mlClassifier}
        />
      )}

      {isRecommendedBatch && (
        <p style={{ fontSize: "0.8125rem", color: "var(--muted)", marginBottom: "1.5rem" }}>
          Model diagnostics above use the frozen snapshot from generation — not live recompute. For live
          Dixon-Coles / ML exploration, select a manual batch in Statistical model diagnostics (when
          available on manual batches).
        </p>
      )}

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
