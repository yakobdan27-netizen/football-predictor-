"use client";

import { LOG_MARKETS } from "@/lib/prediction-log/markets-config";
import type { AnalysisHistory, LogMarketKey } from "@/lib/prediction-log/types";

interface AccuracyBarsProps {
  analysis: AnalysisHistory | null;
  leagueFilter?: string;
}

export function AccuracyBars({ analysis, leagueFilter }: AccuracyBarsProps) {
  if (!analysis || analysis.totalScored === 0) {
    return (
      <p className="page-sub">No scored picks yet. Enter actual results on saved batches.</p>
    );
  }

  const source = leagueFilter
    ? analysis.leagueAccuracy[leagueFilter]
    : analysis.marketAccuracy;

  if (!source || Object.keys(source).length === 0) {
    return (
      <p className="page-sub">
        No scored picks for {leagueFilter ?? "this filter"} yet.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      {LOG_MARKETS.map((def) => {
        const stats = source[def.key as LogMarketKey];
        if (!stats || stats.pct == null) return null;
        const total = stats.correct + stats.wrong;
        if (total === 0) return null;

        return (
          <div key={def.key}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "0.875rem",
                marginBottom: "0.25rem",
              }}
            >
              <span>{def.label}</span>
              <span>
                {stats.pct}% ({stats.correct}/{total})
                {stats.push > 0 ? ` · ${stats.push} push` : ""}
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
              <div
                style={{
                  width: `${stats.pct}%`,
                  height: "100%",
                  background:
                    stats.pct >= 55
                      ? "var(--accent)"
                      : stats.pct >= 45
                        ? "var(--warn)"
                        : "var(--danger)",
                  borderRadius: "4px",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
