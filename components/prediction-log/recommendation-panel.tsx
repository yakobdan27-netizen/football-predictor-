"use client";

import { getOddsRecommendations, getSystematicRules } from "@/lib/prediction-log/odds-recommendations";
import { getRecommendations } from "@/lib/prediction-log/recommendations";
import type { AnalysisHistory } from "@/lib/prediction-log/types";

interface RecommendationPanelProps {
  league: string;
  analysis: AnalysisHistory | null;
}

export function RecommendationPanel({ league, analysis }: RecommendationPanelProps) {
  if (!league) return null;
  const oddsTips = getOddsRecommendations(analysis, league);
  const marketTips = getRecommendations(league, analysis);
  const rules = getSystematicRules();

  return (
    <div style={{ display: "grid", gap: "0.75rem", marginBottom: "1rem" }}>
      <div
        className="card"
        style={{
          borderColor: "var(--accent2)",
          background: "var(--surface2)",
        }}
      >
        <strong style={{ display: "block", marginBottom: "0.5rem" }}>
          Odds recommendations — {league}
        </strong>
        <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem" }}>
          {oddsTips.map((tip, i) => (
            <li key={i} style={{ marginBottom: "0.35rem", color: "var(--muted)" }}>
              {tip}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <strong style={{ display: "block", marginBottom: "0.5rem" }}>
          Systematic approach to odds
        </strong>
        <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem" }}>
          {rules.map((rule, i) => (
            <li key={i} style={{ marginBottom: "0.35rem", color: "var(--muted)" }}>
              {rule}
            </li>
          ))}
        </ul>
      </div>

      {marketTips.length > 0 && analysis && analysis.totalScored > 0 && (
        <div className="card">
          <strong style={{ display: "block", marginBottom: "0.5rem" }}>
            Market accuracy tips
          </strong>
          <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem" }}>
            {marketTips.slice(0, 4).map((tip, i) => (
              <li key={i} style={{ marginBottom: "0.35rem", color: "var(--muted)" }}>
                {tip}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
