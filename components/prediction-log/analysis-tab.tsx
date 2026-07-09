"use client";

import { useState } from "react";
import { AccuracyBars } from "./accuracy-bars";
import { LEAGUE_OPTIONS } from "@/lib/prediction-log/markets-config";
import type { AnalysisHistory } from "@/lib/prediction-log/types";

interface AnalysisTabProps {
  analysis: AnalysisHistory | null;
}

export function AnalysisTab({ analysis }: AnalysisTabProps) {
  const [leagueFilter, setLeagueFilter] = useState<string>("");

  if (!analysis || analysis.totalScored === 0) {
    return (
      <p className="page-sub">
        Analysis appears after you enter actual results on saved batches.
      </p>
    );
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <p style={{ margin: 0, fontSize: "0.875rem" }}>{analysis.calibrationNote}</p>
        <p style={{ margin: "0.5rem 0 0", color: "var(--muted)", fontSize: "0.75rem" }}>
          {analysis.totalScored} scored picks · updated{" "}
          {new Date(analysis.updatedAt).toLocaleString()}
        </p>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label className="label">Filter by league</label>
        <select
          className="select"
          value={leagueFilter}
          onChange={(e) => setLeagueFilter(e.target.value)}
        >
          <option value="">All leagues</option>
          {LEAGUE_OPTIONS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Accuracy by market</h3>
      <AccuracyBars analysis={analysis} leagueFilter={leagueFilter || undefined} />

      <div style={{ display: "grid", gap: "1rem", marginTop: "1.5rem" }}>
        <div className="card">
          <strong>High confidence (&gt;70%)</strong>
          <p style={{ margin: "0.5rem 0 0", color: "var(--muted)" }}>
            {analysis.highConfidenceAccuracy.pct != null
              ? `${analysis.highConfidenceAccuracy.pct}% (${analysis.highConfidenceAccuracy.correct}/${analysis.highConfidenceAccuracy.correct + analysis.highConfidenceAccuracy.wrong})`
              : "Not enough data"}
          </p>
        </div>
        <div className="card">
          <strong>Recent form (last 20 scored)</strong>
          <p style={{ margin: "0.5rem 0 0", color: "var(--muted)" }}>
            {analysis.recentForm.pct != null
              ? `${analysis.recentForm.pct}% (${analysis.recentForm.correct}/${analysis.recentForm.correct + analysis.recentForm.wrong})`
              : "Not enough data"}
          </p>
        </div>
      </div>

      {analysis.topMarkets.length > 0 && (
        <div style={{ marginTop: "1.5rem" }}>
          <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Strongest markets</h3>
          <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "var(--muted)" }}>
            {analysis.topMarkets.map((m) => (
              <li key={m.market}>
                {m.label}: {m.pct}% ({m.total} picks)
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.weakestMarkets.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Weakest markets</h3>
          <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "var(--muted)" }}>
            {analysis.weakestMarkets.map((m) => (
              <li key={m.market}>
                {m.label}: {m.pct}% ({m.total} picks)
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
