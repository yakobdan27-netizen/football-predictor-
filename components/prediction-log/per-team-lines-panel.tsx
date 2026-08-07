"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  PER_TEAM_LINES,
  buildCornersPerTeamBundle,
  buildHtPerTeamBundle,
  buildHtTotalDisplay,
  defaultPerTeamSelection,
  formatLeanLabel,
  pctLabel,
  sourceBadgeLabel,
  type PerTeamLineResult,
  type PerTeamLinesSelection,
  type TotalOuDisplay,
} from "@/lib/prediction-log/per-team-lines";
import type { CornersMatchPrediction } from "@/lib/prediction-log/corners-model";
import type { HshPrediction } from "@/lib/prediction-log/hsh-model";

const STORAGE_KEY = "per_team_lines_selection_v1";

function confidenceStyle(c: "high" | "medium" | "low"): CSSProperties {
  switch (c) {
    case "high":
      return { background: "rgba(34, 197, 94, 0.2)", color: "#15803d" };
    case "medium":
      return { background: "rgba(245, 158, 11, 0.2)", color: "#b45309" };
    default:
      return { background: "var(--surface2)", color: "var(--muted)" };
  }
}

function loadSelection(): PerTeamLinesSelection {
  if (typeof window === "undefined") return defaultPerTeamSelection();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPerTeamSelection();
    const parsed = JSON.parse(raw) as Partial<PerTeamLinesSelection>;
    const d = defaultPerTeamSelection();
    return {
      cornersHome: parsed.cornersHome ?? d.cornersHome,
      cornersAway: parsed.cornersAway ?? d.cornersAway,
      htHome: parsed.htHome ?? d.htHome,
      htAway: parsed.htAway ?? d.htAway,
      htTotal: parsed.htTotal ?? d.htTotal,
    };
  } catch {
    return defaultPerTeamSelection();
  }
}

function Badge({
  children,
  style,
  title,
}: {
  children: ReactNode;
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <span
      className="badge"
      title={title}
      style={{
        fontSize: "0.65rem",
        fontWeight: 700,
        padding: "0.15rem 0.4rem",
        borderRadius: 4,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function TotalRow({
  label,
  text,
  confidence,
}: {
  label: string;
  text: string;
  confidence?: "high" | "medium" | "low";
}) {
  return (
    <div className="ptl-total-row">
      <span className="ptl-label">{label}</span>
      <span className="ptl-value">{text}</span>
      {confidence ? (
        <Badge style={confidenceStyle(confidence)} title="Confidence">
          {confidence}
        </Badge>
      ) : null}
    </div>
  );
}

function LineRow({
  label,
  row,
  alternates,
  onPickLine,
  expanded,
  onToggle,
}: {
  label: string;
  row: PerTeamLineResult;
  alternates: readonly number[];
  onPickLine: (line: number) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const main = row.insufficient
    ? "INSUFFICIENT DATA"
    : `${formatLeanLabel(row.lean, row.line)} (${pctLabel(row.leanPct)})`;

  return (
    <div className="ptl-line-block">
      <button type="button" className="ptl-line-row" onClick={onToggle}>
        <span className="ptl-label">{label}</span>
        <span className="ptl-value">{main}</span>
        <span className="ptl-badges">
          {!row.insufficient ? (
            <Badge style={confidenceStyle(row.confidence)}>{row.confidence}</Badge>
          ) : null}
          <Badge
            style={
              row.insufficient
                ? { background: "rgba(239, 68, 68, 0.15)", color: "#fca5a5" }
                : { background: "var(--surface2)", color: "var(--muted)" }
            }
            title="Intensity source"
          >
            {sourceBadgeLabel(row.source)}
          </Badge>
        </span>
        <span className="ptl-chevron" aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded ? (
        <div className="ptl-alts" role="group" aria-label={`${label} alternate lines`}>
          {alternates.map((line) => (
            <button
              key={line}
              type="button"
              className={`ptl-alt-btn${line === row.line ? " active" : ""}`}
              onClick={() => onPickLine(line)}
            >
              {line}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export interface PerTeamLinesPanelProps {
  /** Existing total corners copy (unchanged math — parent formats). */
  cornersTotal?: {
    text: string;
    confidence: "high" | "medium" | "low";
  } | null;
  corners?: CornersMatchPrediction | null;
  hsh?: HshPrediction | null;
  /** When true, also show display-only TOTAL HT GOALS from λ1h. */
  showHtTotal?: boolean;
  compact?: boolean;
}

export function PerTeamLinesPanel({
  cornersTotal,
  corners,
  hsh,
  showHtTotal = true,
  compact = false,
}: PerTeamLinesPanelProps) {
  const [sel, setSel] = useState<PerTeamLinesSelection>(defaultPerTeamSelection);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    setSel(loadSelection());
  }, []);

  function updateSel(patch: Partial<PerTeamLinesSelection>) {
    setSel((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const cornerBundle = useMemo(
    () =>
      corners
        ? buildCornersPerTeamBundle(corners, {
            home: sel.cornersHome,
            away: sel.cornersAway,
          })
        : null,
    [corners, sel.cornersHome, sel.cornersAway]
  );

  const htBundle = useMemo(
    () =>
      hsh
        ? buildHtPerTeamBundle(hsh, { home: sel.htHome, away: sel.htAway })
        : null,
    [hsh, sel.htHome, sel.htAway]
  );

  const htTotal: TotalOuDisplay | null = useMemo(
    () => (hsh && showHtTotal ? buildHtTotalDisplay(hsh, sel.htTotal) : null),
    [hsh, showHtTotal, sel.htTotal]
  );

  if (!corners && !hsh) return null;

  return (
    <div className={`ptl-panel${compact ? " ptl-compact" : ""}`}>
      <style>{`
        .ptl-panel {
          display: grid;
          gap: 0.5rem;
          margin-top: 0.75rem;
          padding: 0.75rem;
          border: 1px solid var(--border);
          border-radius: 12px;
          background: var(--surface);
          font-size: 0.8125rem;
        }
        .ptl-compact { padding: 0.55rem; font-size: 0.75rem; }
        .ptl-section-title {
          font-size: 0.7rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--muted);
          margin: 0.15rem 0;
        }
        .ptl-divider {
          height: 1px;
          background: var(--border);
          margin: 0.25rem 0;
        }
        .ptl-total-row, .ptl-line-row {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.4fr) auto auto;
          gap: 0.35rem 0.5rem;
          align-items: center;
          width: 100%;
          text-align: left;
          background: transparent;
          border: none;
          color: inherit;
          padding: 0.4rem 0;
          min-height: 2.75rem;
          touch-action: manipulation;
        }
        .ptl-line-row { cursor: pointer; border-radius: 8px; }
        .ptl-line-row:active { background: var(--surface2); }
        .ptl-label { font-weight: 700; font-size: 0.72rem; color: var(--muted); }
        .ptl-value { font-weight: 700; }
        .ptl-badges { display: flex; flex-wrap: wrap; gap: 0.25rem; justify-content: flex-end; }
        .ptl-chevron { color: var(--muted); font-size: 0.75rem; width: 1rem; text-align: center; }
        .ptl-grid {
          display: grid;
          gap: 0.15rem;
        }
        @media (min-width: 640px) {
          .ptl-grid-2 {
            grid-template-columns: 1fr 1fr;
            gap: 0.5rem 1rem;
          }
        }
        .ptl-alts {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
          padding: 0 0 0.5rem 0;
        }
        .ptl-alt-btn {
          min-height: 2.5rem;
          min-width: 2.75rem;
          padding: 0.35rem 0.55rem;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--surface2);
          color: inherit;
          font-weight: 700;
          font-size: 0.8125rem;
          cursor: pointer;
          touch-action: manipulation;
        }
        .ptl-alt-btn.active {
          border-color: var(--accent);
          background: var(--accent);
          color: #052e16;
        }
      `}</style>

      {(cornersTotal || htTotal) && (
        <>
          <div className="ptl-section-title">Match totals</div>
          {cornersTotal ? (
            <TotalRow
              label="TOTAL CORNERS"
              text={cornersTotal.text}
              confidence={cornersTotal.confidence}
            />
          ) : null}
          {htTotal ? (
            <div>
              <TotalRow
                label={htTotal.label}
                text={`${formatLeanLabel(htTotal.lean, htTotal.line)} (${pctLabel(htTotal.leanPct)})`}
                confidence={htTotal.confidence}
              />
              <div className="ptl-alts" style={{ paddingTop: 0 }}>
                {PER_TEAM_LINES.halfGoals.alternates.map((line) => (
                  <button
                    key={`ht-total-${line}`}
                    type="button"
                    className={`ptl-alt-btn${line === sel.htTotal ? " active" : ""}`}
                    onClick={() => updateSel({ htTotal: line })}
                  >
                    {line}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="ptl-divider" />
        </>
      )}

      {cornerBundle ? (
        <>
          <div className="ptl-section-title">Per-team corners</div>
          <div className="ptl-grid ptl-grid-2">
            <LineRow
              label="HOME CORNERS"
              row={cornerBundle.home}
              alternates={PER_TEAM_LINES.corners.alternates}
              expanded={expandedKey === "c-home"}
              onToggle={() => setExpandedKey((k) => (k === "c-home" ? null : "c-home"))}
              onPickLine={(line) => updateSel({ cornersHome: line })}
            />
            <LineRow
              label="AWAY CORNERS"
              row={cornerBundle.away}
              alternates={PER_TEAM_LINES.corners.alternates}
              expanded={expandedKey === "c-away"}
              onToggle={() => setExpandedKey((k) => (k === "c-away" ? null : "c-away"))}
              onPickLine={(line) => updateSel({ cornersAway: line })}
            />
          </div>
        </>
      ) : null}

      {htBundle ? (
        <>
          {cornerBundle ? <div className="ptl-divider" /> : null}
          <div className="ptl-section-title">Per-team HT goals</div>
          <div className="ptl-grid ptl-grid-2">
            <LineRow
              label="HOME HT GOALS"
              row={htBundle.home}
              alternates={PER_TEAM_LINES.halfGoals.alternates}
              expanded={expandedKey === "h-home"}
              onToggle={() => setExpandedKey((k) => (k === "h-home" ? null : "h-home"))}
              onPickLine={(line) => updateSel({ htHome: line })}
            />
            <LineRow
              label="AWAY HT GOALS"
              row={htBundle.away}
              alternates={PER_TEAM_LINES.halfGoals.alternates}
              expanded={expandedKey === "h-away"}
              onToggle={() => setExpandedKey((k) => (k === "h-away" ? null : "h-away"))}
              onPickLine={(line) => updateSel({ htAway: line })}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
