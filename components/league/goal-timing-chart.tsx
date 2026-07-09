"use client";

import type { LeagueGoalTimingProfile } from "@/lib/prediction-log/types";

const BUCKET_LABELS: Array<{ key: keyof Omit<LeagueGoalTimingProfile, "sampleSize">; label: string }> = [
  { key: "g0_15", label: "0–15" },
  { key: "g16_30", label: "16–30" },
  { key: "g31_45", label: "31–45" },
  { key: "g46_60", label: "46–60" },
  { key: "g61_75", label: "61–75" },
  { key: "g76_90plus", label: "76–90+" },
];

interface GoalTimingChartProps {
  curve: LeagueGoalTimingProfile;
}

export function GoalTimingChart({ curve }: GoalTimingChartProps) {
  if (curve.sampleSize < 1) {
    return <p className="page-sub">No goal timing buckets logged yet.</p>;
  }

  const total = BUCKET_LABELS.reduce((sum, b) => sum + (curve[b.key] ?? 0), 0);
  if (total <= 0) {
    return <p className="page-sub">Enter per-bucket goal counts on match results to build the curve.</p>;
  }

  const max = Math.max(...BUCKET_LABELS.map((b) => curve[b.key] ?? 0), 1);

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      {BUCKET_LABELS.map(({ key, label }) => {
        const count = curve[key] ?? 0;
        const pct = Math.round((count / total) * 100);
        return (
          <div key={key}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "0.8125rem",
                marginBottom: "0.2rem",
              }}
            >
              <span>{label} min</span>
              <span>
                {count} goals ({pct}%)
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
                  width: `${(count / max) * 100}%`,
                  height: "100%",
                  background: "var(--accent)",
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
