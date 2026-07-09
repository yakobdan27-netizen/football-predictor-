"use client";

import { useState } from "react";
import { AccuracyBars } from "./accuracy-bars";
import { LEAGUE_OPTIONS } from "@/lib/prediction-log/markets-config";
import {
  getOddsRecommendations,
  getSystematicRules,
} from "@/lib/prediction-log/odds-recommendations";
import { ODDS_BAND_LABELS } from "@/lib/prediction-log/odds-bands";
import type { AnalysisHistory } from "@/lib/prediction-log/types";

interface RecommendationsTabProps {
  analysis: AnalysisHistory | null;
}

export function RecommendationsTab({ analysis }: RecommendationsTabProps) {
  const [leagueFilter, setLeagueFilter] = useState<string>(LEAGUE_OPTIONS[0]);
  const rules = getSystematicRules();
  const tips = getOddsRecommendations(analysis, leagueFilter);

  if (!analysis || analysis.totalScored === 0) {
    return (
      <p className="page-sub">
        Recommendations appear after you enter results on saved batches with odds.
      </p>
    );
  }

  const oa = analysis.oddsAnalysis;

  return (
    <div>
      <div style={{ marginBottom: "1rem" }}>
        <label className="label">League for recommendations</label>
        <select
          className="select"
          value={leagueFilter}
          onChange={(e) => setLeagueFilter(e.target.value)}
        >
          {LEAGUE_OPTIONS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <strong style={{ display: "block", marginBottom: "0.5rem" }}>
          Personalized odds advice
        </strong>
        <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem" }}>
          {tips.map((tip, i) => (
            <li key={i} style={{ marginBottom: "0.35rem", color: "var(--muted)" }}>
              {tip}
            </li>
          ))}
        </ul>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <strong style={{ display: "block", marginBottom: "0.5rem" }}>
          Systematic approach
        </strong>
        <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem" }}>
          {rules.map((rule, i) => (
            <li key={i} style={{ marginBottom: "0.35rem", color: "var(--muted)" }}>
              {rule}
            </li>
          ))}
        </ul>
      </div>

      {oa.mostWonBand && (
        <div className="card" style={{ marginBottom: "1rem", fontSize: "0.875rem" }}>
          <p style={{ margin: 0 }}>{analysis.calibrationNote}</p>
        </div>
      )}

      <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Market accuracy</h3>
      <AccuracyBars analysis={analysis} leagueFilter={leagueFilter} />

      <div style={{ display: "grid", gap: "1rem", marginTop: "1.5rem" }}>
        <div className="card">
          <strong>High confidence (&gt;70%)</strong>
          <p style={{ margin: "0.5rem 0 0", color: "var(--muted)" }}>
            {analysis.highConfidenceAccuracy.pct != null
              ? `${analysis.highConfidenceAccuracy.pct}%`
              : "Not enough data"}
          </p>
        </div>
        <div className="card">
          <strong>Recent form (last 20)</strong>
          <p style={{ margin: "0.5rem 0 0", color: "var(--muted)" }}>
            {analysis.recentForm.pct != null
              ? `${analysis.recentForm.pct}%`
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
                {m.label}: {m.pct}%
              </li>
            ))}
          </ul>
        </div>
      )}

      {oa.bestValueBand && (
        <div style={{ marginTop: "1rem", fontSize: "0.875rem", color: "var(--muted)" }}>
          Historical best value odds band: {ODDS_BAND_LABELS[oa.bestValueBand]}
        </div>
      )}
    </div>
  );
}
