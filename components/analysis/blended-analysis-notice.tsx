"use client";

import { useState } from "react";
import type { BlendedPayload } from "@/lib/analysis/blended-analysis-service";
import { shouldDisplayBlended } from "@/lib/analysis/blended-analysis-service";

type Props = {
  /** Envelope from CFE / service — if omitted, notice hidden. */
  blend?: BlendedPayload<Record<string, number | null | undefined>> | null;
  pageLabel?: string;
};

function fmtRange(from: string | null, to: string | null): string {
  if (!from && !to) return "n/a";
  if (from && to && from !== to) return `${from} → ${to}`;
  return from ?? to ?? "n/a";
}

function confidenceLabel(c: number): string {
  if (c >= 0.75) return "High";
  if (c >= 0.45) return "Medium";
  return "Low";
}

/**
 * Small disclosure when blended analysis mode is active.
 * Does not change layout hierarchy — sit above existing page content.
 */
export function BlendedAnalysisNotice({ blend, pageLabel }: Props) {
  const [open, setOpen] = useState(false);
  if (!blend?.enabled) return null;

  const showAsPrimary = shouldDisplayBlended(blend);
  const api = blend.sourceBreakdown.api;
  const sys = blend.sourceBreakdown.system;
  const warning =
    blend.status !== "complete"
      ? blend.fallbackReason ??
        blend.quality.warnings[0] ??
        "Using legacy analysis while blended data is incomplete."
      : null;

  return (
    <div
      style={{
        marginBottom: 12,
        padding: "10px 12px",
        border: "1px solid var(--border, #ddd)",
        borderRadius: 6,
        background: "var(--surface2, #f6f6f6)",
        fontSize: 13,
        lineHeight: 1.45,
        color: "var(--text, #222)",
      }}
    >
      <div>
        Analysis uses 60% API historical data and 40% system historical data
        (manual batches, prior system records, and AI learner data).
        {pageLabel ? (
          <span style={{ color: "var(--muted, #666)" }}> ({pageLabel})</span>
        ) : null}
      </div>
      <div
        style={{
          marginTop: 6,
          display: "flex",
          flexWrap: "wrap",
          gap: "10px 16px",
          color: "var(--muted, #555)",
        }}
      >
        <span>
          API: {api.recordCount} records
          {api.dateRange.from || api.dateRange.to
            ? ` · ${fmtRange(api.dateRange.from, api.dateRange.to)}`
            : ""}
        </span>
        <span>
          System: {sys.recordCount} records
          {sys.dateRange.from || sys.dateRange.to
            ? ` · ${fmtRange(sys.dateRange.from, sys.dateRange.to)}`
            : ""}
        </span>
        <span>
          Confidence: {confidenceLabel(blend.quality.confidence)} (
          {Math.round(blend.quality.confidence * 100)}%)
        </span>
        <span>
          Status: {showAsPrimary ? "blended" : blend.status}
        </span>
      </div>
      {warning ? (
        <div
          style={{
            marginTop: 6,
            color: "var(--muted, #6b5b00)",
            background: "rgba(245, 158, 11, 0.12)",
            padding: "4px 8px",
            borderRadius: 4,
          }}
        >
          {warning}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          marginTop: 6,
          border: "none",
          background: "transparent",
          color: "var(--accent, #2563eb)",
          cursor: "pointer",
          padding: 0,
          fontSize: 12,
          textDecoration: "underline",
        }}
      >
        {open ? "Hide source details" : "Source details"}
      </button>
      {open ? (
        <ul
          style={{
            margin: "6px 0 0",
            paddingLeft: 18,
            color: "var(--muted, #555)",
            fontSize: 12,
          }}
        >
          <li>
            Configured weights: API {Math.round(api.configuredWeight * 100)}% /
            System {Math.round(sys.configuredWeight * 100)}%
          </li>
          <li>
            Effective weights: API {Math.round(api.effectiveWeight * 100)}% /
            System {Math.round(sys.effectiveWeight * 100)}%
          </li>
          <li>Calculation: {blend.calculationVersion}</li>
          {blend.quality.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Pick a representative blend envelope from a map of CFE estimates. */
export function pickBlendFromEstimates(
  estimatesById: Record<
    string,
    { analysisBlend?: BlendedPayload<Record<string, number | null | undefined>> }
  >
): BlendedPayload<Record<string, number | null | undefined>> | null {
  for (const est of Object.values(estimatesById)) {
    if (est.analysisBlend?.enabled) return est.analysisBlend;
  }
  return null;
}
