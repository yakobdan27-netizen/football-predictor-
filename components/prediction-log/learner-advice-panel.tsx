"use client";

import type { LearnerStatsStore } from "@/lib/prediction-log/types";

interface LearnerAdvicePanelProps {
  stats: LearnerStatsStore;
  enabled: boolean;
}

export function LearnerAdvicePanel({ stats, enabled }: LearnerAdvicePanelProps) {
  const advice = stats.advice;

  return (
    <div
      className="card"
      style={{
        marginBottom: "1rem",
        borderColor: enabled ? "var(--accent)" : "var(--border)",
        background: enabled ? "rgba(76, 175, 80, 0.05)" : undefined,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
        <strong style={{ fontSize: "0.9375rem" }}>AI Learner Advice</strong>
        <span
          style={{
            fontSize: "0.7rem",
            fontWeight: 700,
            color: enabled ? "var(--accent)" : "var(--muted)",
            textTransform: "uppercase",
          }}
        >
          {enabled ? "Active" : "Off"}
        </span>
      </div>

      <p style={{ fontSize: "0.8125rem", color: "var(--muted)", marginTop: "0.5rem" }}>
        {advice.summaryLine}
      </p>

      <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
        <div>
          <div className="stat-label">Top reliable odds ranges</div>
          {advice.topReliableRanges.length === 0 ? (
            <p style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
              Save {5 - stats.totalScoredPicks > 0 ? Math.max(0, 5 - stats.totalScoredPicks) : 5}+ scored picks to unlock range rankings.
            </p>
          ) : (
            <ul style={{ fontSize: "0.8125rem", paddingLeft: "1.25rem", margin: 0 }}>
              {advice.topReliableRanges.map((r) => (
                <li key={r.band}>
                  <strong>{r.band}</strong> — {r.winRate}% ({r.sample} picks)
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="stat-label">Clubs to treat with caution</div>
          {advice.cautiousClubs.length === 0 ? (
            <p style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>None flagged yet.</p>
          ) : (
            <ul style={{ fontSize: "0.8125rem", paddingLeft: "1.25rem", margin: 0 }}>
              {advice.cautiousClubs.slice(0, 5).map((c) => (
                <li key={`${c.league}-${c.clubName}`}>
                  <strong>{c.clubName}</strong>
                  {c.winRate != null ? ` (${c.winRate}%)` : ""} — {c.reason}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="stat-label">Suggested combined-odds ceiling</div>
          <strong style={{ fontSize: "1.125rem", color: "var(--accent)" }}>
            {advice.suggestedCombinedOddsCeiling}
          </strong>
          <span style={{ fontSize: "0.8125rem", color: "var(--muted)", marginLeft: "0.5rem" }}>
            based on your batch win patterns
          </span>
        </div>

        {advice.batchPatternWarnings.length > 0 && (
          <div>
            <div className="stat-label">Batch risk patterns</div>
            <ul style={{ fontSize: "0.8125rem", paddingLeft: "1.25rem", margin: 0, color: "var(--warn)" }}>
              {advice.batchPatternWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.75rem" }}>
        {stats.totalBatchesWithResults} batches with results · {stats.totalScoredPicks} scored picks ·
        updated {new Date(stats.updatedAt).toLocaleString()}
      </p>
    </div>
  );
}
