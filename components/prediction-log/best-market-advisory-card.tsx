"use client";

import { useState } from "react";
import type { MarketAdvisoryUiPayload } from "@/lib/market-advisory/types";

type Props = {
  advisory: MarketAdvisoryUiPayload | null;
  loading?: boolean;
  compact?: boolean;
};

function MiniBar({ value, label }: { value: number; label: string }) {
  return (
    <div style={{ flex: 1, minWidth: 60 }}>
      <div style={{ fontSize: "0.65rem", color: "var(--muted)", marginBottom: 2 }}>
        {label}
      </div>
      <div
        style={{
          height: 4,
          borderRadius: 2,
          background: "var(--border)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(100, value)}%`,
            height: "100%",
            background:
              value >= 70 ? "#22c55e" : value >= 50 ? "#eab308" : "#f97316",
          }}
        />
      </div>
      <div style={{ fontSize: "0.65rem", marginTop: 1 }}>{Math.round(value)}</div>
    </div>
  );
}

function tierColor(tier: string): string {
  switch (tier) {
    case "Strong":
      return "#22c55e";
    case "Usable":
      return "#3b82f6";
    case "Caution":
      return "#eab308";
    default:
      return "var(--muted)";
  }
}

export function BestMarketAdvisoryCard({ advisory, loading, compact }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (loading) {
    return (
      <div
        className="msam-advisory-card"
        style={{
          padding: "0.75rem",
          borderRadius: 10,
          border: "1px solid var(--border)",
          marginTop: "0.5rem",
          fontSize: "0.85rem",
          color: "var(--muted)",
        }}
      >
        Loading Best Market Advisory…
      </div>
    );
  }

  if (!advisory || advisory.primary.length === 0) {
    return (
      <div
        className="msam-advisory-card"
        style={{
          padding: "0.75rem",
          borderRadius: 10,
          border: "1px solid var(--border)",
          marginTop: "0.5rem",
          fontSize: "0.85rem",
        }}
      >
        <span
          style={{
            fontSize: "0.65rem",
            padding: "2px 6px",
            borderRadius: 4,
            background: "var(--border)",
            marginRight: 8,
          }}
        >
          BETA
        </span>
        Best Market Advisory — insufficient eligible evidence for diversified picks.
        {advisory?.ineligibleNotes?.map((n, i) => (
          <div key={i} style={{ marginTop: 4, color: "var(--muted)", fontSize: "0.8rem" }}>
            {n}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className="msam-advisory-card"
      style={{
        padding: compact ? "0.65rem" : "0.85rem",
        borderRadius: 10,
        border: "1px solid var(--border)",
        marginTop: "0.5rem",
        background: "var(--card-bg, transparent)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: "0.65rem",
          flexWrap: "wrap",
        }}
      >
        <strong style={{ fontSize: "0.9rem" }}>Best Market Advisory</strong>
        <span
          style={{
            fontSize: "0.65rem",
            padding: "2px 6px",
            borderRadius: 4,
            background: "#6366f1",
            color: "#fff",
          }}
        >
          BETA
        </span>
        <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          {advisory.sourceCoverage.label}
        </span>
        {advisory.cqsBootstrap && (
          <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
            Calibration: provisional (bootstrap)
          </span>
        )}
      </div>

      <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: "0 0 0.65rem" }}>
        Advisory only — not a guarantee. Probabilities reflect pre-kickoff model evidence.
      </p>

      {advisory.specialistCoverage && (
        <div
          style={{
            fontSize: "0.75rem",
            color: "var(--muted)",
            marginBottom: "0.65rem",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {advisory.specialistCoverage.ht && (
            <div>
              HT coverage: {advisory.specialistCoverage.ht.pct ?? "—"}% · API{" "}
              {Math.round(advisory.specialistCoverage.ht.effectiveApiWeight * 100)}% / System{" "}
              {Math.round(advisory.specialistCoverage.ht.effectiveSystemWeight * 100)}% (api n=
              {advisory.specialistCoverage.ht.apiRecords}, system n=
              {advisory.specialistCoverage.ht.systemRecords})
            </div>
          )}
          {advisory.specialistCoverage.corners && (
            <div>
              Corners coverage: {advisory.specialistCoverage.corners.pct ?? "—"}% · API{" "}
              {Math.round(advisory.specialistCoverage.corners.effectiveApiWeight * 100)}% / System{" "}
              {Math.round(advisory.specialistCoverage.corners.effectiveSystemWeight * 100)}% (api n=
              {advisory.specialistCoverage.corners.apiRecords}, system n=
              {advisory.specialistCoverage.corners.systemRecords})
            </div>
          )}
        </div>
      )}

      {advisory.primary.map((p) => (
        <div
          key={p.rank}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0.65rem",
            marginBottom: "0.5rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div>
              <span style={{ fontWeight: 600 }}>#{p.rank} </span>
              <span>{p.marketLabel} — {p.prediction}</span>
              <div style={{ fontSize: "0.85rem", marginTop: 2 }}>
                <strong>{p.probabilityPct}%</strong> occurrence probability
              </div>
            </div>
            <div style={{ textAlign: "right", fontSize: "0.75rem" }}>
              <div style={{ color: tierColor(p.tier) }}>{p.tier}</div>
              <div style={{ color: "var(--muted)" }}>{p.agreementStatus}</div>
              {p.finalAdvisoryScore != null && (
                <div>Final: {p.finalAdvisoryScore}</div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <MiniBar value={p.dimensions.ecs} label="Coverage" />
            <MiniBar value={p.dimensions.cqs} label="Calibration" />
            <MiniBar value={p.dimensions.sss} label="Stability" />
          </div>

          <p style={{ fontSize: "0.78rem", margin: "8px 0 0", color: "var(--muted)" }}>
            {p.explanation}
          </p>

          <button
            type="button"
            onClick={() => setExpanded(expanded === p.rank ? null : p.rank)}
            style={{
              marginTop: 8,
              fontSize: "0.75rem",
              background: "none",
              border: "none",
              color: "var(--link, #3b82f6)",
              cursor: "pointer",
              padding: "4px 0",
              minHeight: 44,
            }}
          >
            {expanded === p.rank ? "Hide data quality" : "Why / Data Quality"}
          </button>

          {expanded === p.rank && (
            <pre
              style={{
                fontSize: "0.7rem",
                overflow: "auto",
                maxHeight: 200,
                background: "var(--border)",
                padding: 8,
                borderRadius: 6,
                marginTop: 4,
              }}
            >
              {JSON.stringify(p.expandable, null, 2)}
            </pre>
          )}
        </div>
      ))}

      {advisory.alternatives.length > 0 && (
        <details style={{ fontSize: "0.8rem", marginTop: 4 }}>
          <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>
            Alternatives ({advisory.alternatives.length})
          </summary>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {advisory.alternatives.map((a, i) => (
              <li key={i}>
                {a.marketLabel} — {a.prediction} ({a.probabilityPct}%)
                {a.overlapNote && (
                  <span style={{ color: "var(--muted)" }}> · {a.overlapNote}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {advisory.warnings.length > 0 && (
        <div style={{ fontSize: "0.75rem", color: "#eab308", marginTop: 8 }}>
          {advisory.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}
    </div>
  );
}
