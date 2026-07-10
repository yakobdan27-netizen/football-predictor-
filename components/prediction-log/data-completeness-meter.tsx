"use client";

import {
  dataCompletenessLabel,
  dataCompletenessLevel,
  dataCompletenessPct,
  type DataCompletenessLevel,
} from "@/lib/prediction-log/data-completeness";

interface DataCompletenessMeterProps {
  sampleSize: number;
  label?: string;
  compact?: boolean;
}

function levelColor(level: DataCompletenessLevel): string {
  if (level === "ready") return "var(--accent)";
  if (level === "warm") return "var(--warn)";
  return "var(--muted)";
}

export function DataCompletenessMeter({
  sampleSize,
  label = "Data",
  compact = false,
}: DataCompletenessMeterProps) {
  const level = dataCompletenessLevel(sampleSize);
  const pct = dataCompletenessPct(sampleSize);
  return (
    <div
      title={`${label}: ${dataCompletenessLabel(level)} (${sampleSize} samples)`}
      style={{ minWidth: compact ? 72 : 120 }}
    >
      {!compact ? (
        <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: 2 }}>
          {label}: {dataCompletenessLabel(level)}
        </div>
      ) : null}
      <div
        style={{
          height: compact ? 4 : 6,
          borderRadius: 4,
          background: "var(--border)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: levelColor(level),
            transition: "width 0.2s ease",
          }}
        />
      </div>
      {compact ? (
        <div style={{ fontSize: "0.65rem", color: levelColor(level), marginTop: 2 }}>
          {level === "ready" ? "Ready" : level === "warm" ? "Warm" : "Low"}
        </div>
      ) : null}
    </div>
  );
}
