"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  categoryIcon,
  confidenceTone,
  formatUserMarketEvalLine,
  listRegisteredResultPages,
  processBatchDecisions,
  type MatchDecisionRow,
  type ScoredDecisionMarket,
  type UserMarketEvaluation,
} from "@/lib/prediction-log/decision-maker";
import type { ComboCandidate } from "@/lib/prediction-log/combo-selection";
import { getBatchDisplayId } from "@/lib/prediction-log/snapshot-readers";
import { usePredictionLogData } from "./use-prediction-log-data";

function toneStyle(confidence: number): CSSProperties {
  const tone = confidenceTone(confidence);
  switch (tone) {
    case "green":
      return { background: "rgba(34, 197, 94, 0.18)", color: "#15803d" };
    case "yellow":
      return { background: "rgba(234, 179, 8, 0.2)", color: "#a16207" };
    case "orange":
      return { background: "rgba(249, 115, 22, 0.18)", color: "#c2410c" };
    default:
      return { background: "var(--surface2)", color: "var(--muted)" };
  }
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const tone = confidenceTone(confidence);
  const fill =
    tone === "green"
      ? "#22c55e"
      : tone === "yellow"
        ? "#eab308"
        : tone === "orange"
          ? "#f97316"
          : "var(--muted)";
  return (
    <div style={{ marginTop: "0.35rem" }}>
      <div
        style={{
          height: 6,
          borderRadius: 999,
          background: "var(--surface2)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(100, Math.max(0, confidence))}%`,
            height: "100%",
            background: fill,
          }}
        />
      </div>
      <div style={{ fontSize: "0.75rem", fontWeight: 700, marginTop: 2 }}>
        {Math.round(confidence)}%
      </div>
    </div>
  );
}

function MarketCell({ market }: { market: ScoredDecisionMarket }) {
  return (
    <div
      style={{
        ...toneStyle(market.confidence),
        borderRadius: 10,
        padding: "0.65rem 0.75rem",
        minWidth: 160,
      }}
    >
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
        <span aria-hidden>{categoryIcon(market.category)}</span>
        <span style={{ fontSize: "0.7rem", fontWeight: 700, opacity: 0.85 }}>
          {market.label}
        </span>
      </div>
      <div style={{ fontWeight: 700, fontSize: "0.9rem", lineHeight: 1.25 }}>
        {market.prediction}
      </div>
      <ConfidenceBar confidence={market.confidence} />
      <div style={{ fontSize: "0.65rem", marginTop: 4, opacity: 0.8 }}>
        {market.pageLabel}
      </div>
    </div>
  );
}

function CombinedOddCell({ combo }: { combo: ComboCandidate | null }) {
  if (!combo) {
    return (
      <div
        style={{
          borderRadius: 10,
          padding: "0.65rem 0.75rem",
          minWidth: 160,
          background: "var(--surface2)",
          color: "var(--muted)",
          fontSize: "0.8rem",
        }}
      >
        No combo available
      </div>
    );
  }
  const conf = Math.round(combo.pFinal);
  return (
    <div
      style={{
        ...toneStyle(conf),
        borderRadius: 10,
        padding: "0.65rem 0.75rem",
        minWidth: 160,
        border: "1px solid rgba(59, 130, 246, 0.45)",
      }}
    >
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
        <span aria-hidden>🎲</span>
        <span style={{ fontSize: "0.7rem", fontWeight: 700, opacity: 0.85 }}>
          Combination Odd
        </span>
      </div>
      <div style={{ fontWeight: 700, fontSize: "0.9rem", lineHeight: 1.25 }}>
        {combo.label}
      </div>
      <ConfidenceBar confidence={conf} />
      <div style={{ fontSize: "0.7rem", marginTop: 4, fontWeight: 600 }}>
        Odds{" "}
        {combo.odds != null && combo.odds > 1 ? combo.odds.toFixed(2) : "—"}
        {combo.value != null ? ` · value ${combo.value.toFixed(1)}` : ""}
      </div>
    </div>
  );
}

function UserMarketEvalCell({ evalRow }: { evalRow: UserMarketEvaluation }) {
  if (evalRow.status === "none") {
    return (
      <div
        style={{
          borderRadius: 10,
          padding: "0.65rem 0.75rem",
          minWidth: 160,
          background: "var(--surface2)",
          color: "var(--muted)",
          fontSize: "0.8rem",
        }}
      >
        No user market selected
      </div>
    );
  }
  const pct = evalRow.probabilityPct ?? 0;
  return (
    <div
      style={{
        ...toneStyle(pct),
        borderRadius: 10,
        padding: "0.65rem 0.75rem",
        minWidth: 180,
      }}
    >
      <div style={{ fontSize: "0.7rem", fontWeight: 700, opacity: 0.85, marginBottom: 4 }}>
        User market
      </div>
      <div style={{ fontWeight: 700, fontSize: "0.85rem", lineHeight: 1.25 }}>
        {formatUserMarketEvalLine(evalRow)}
      </div>
      <ConfidenceBar confidence={pct} />
      <div style={{ fontSize: "0.7rem", marginTop: 4, lineHeight: 1.35, opacity: 0.9 }}>
        {evalRow.comment}
      </div>
    </div>
  );
}

function DecisionRow({
  row,
  batchDate,
  expanded,
  onToggle,
}: {
  row: MatchDecisionRow;
  batchDate: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [m1, m2, m3] = row.markets;
  const dateTime = row.match.matchDate ?? batchDate;

  return (
    <>
      <tr className="dm-desktop-row">
        <td style={{ minWidth: 160, verticalAlign: "top" }}>
          <div style={{ fontWeight: 700 }}>
            {row.match.homeTeam} vs {row.match.awayTeam}
          </div>
          {row.incomplete && (
            <div
              title={`Incomplete sources: ${row.missingSources.join(", ") || "unknown"}`}
              style={{
                marginTop: 6,
                fontSize: "0.7rem",
                color: "#c2410c",
                fontWeight: 600,
              }}
            >
              ⚠ Incomplete ({row.sourceCount})
            </div>
          )}
        </td>
        <td style={{ minWidth: 100, fontSize: "0.8rem", verticalAlign: "top" }}>
          {row.league}
        </td>
        <td style={{ minWidth: 90, fontSize: "0.8rem", color: "var(--muted)", verticalAlign: "top" }}>
          {dateTime}
        </td>
        <td style={{ minWidth: 160 }}>{m1 ? <MarketCell market={m1} /> : "—"}</td>
        <td style={{ minWidth: 160 }}>{m2 ? <MarketCell market={m2} /> : "—"}</td>
        <td style={{ minWidth: 160 }}>{m3 ? <MarketCell market={m3} /> : "—"}</td>
        <td style={{ minWidth: 160 }}>
          <CombinedOddCell combo={row.bestCombined} />
        </td>
        <td style={{ minWidth: 180 }}>
          <UserMarketEvalCell evalRow={row.userMarketEval} />
        </td>
        <td style={{ minWidth: 90, verticalAlign: "top" }}>
          <div style={{ ...toneStyle(row.confidenceScore), borderRadius: 10, padding: "0.5rem" }}>
            <ConfidenceBar confidence={row.confidenceScore} />
          </div>
        </td>
      </tr>

      <tr className="dm-mobile-row">
        <td colSpan={9} style={{ padding: "0.5rem 0" }}>
          <button
            type="button"
            onClick={onToggle}
            style={{
              width: "100%",
              textAlign: "left",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "0.85rem",
              background: "var(--surface)",
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700 }}>
                  {row.match.homeTeam} vs {row.match.awayTeam}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                  {row.league} · {dateTime} · conf {row.confidenceScore}%
                  {row.incomplete ? " · ⚠ incomplete" : ""}
                </div>
              </div>
              <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                {expanded ? "▴" : "▾"}
              </span>
            </div>
            {m1 && (
              <div style={{ marginTop: "0.65rem" }}>
                <MarketCell market={m1} />
              </div>
            )}
            {expanded && (
              <div
                style={{
                  marginTop: "0.5rem",
                  display: "grid",
                  gap: "0.5rem",
                }}
              >
                {m2 && <MarketCell market={m2} />}
                {m3 && <MarketCell market={m3} />}
                <CombinedOddCell combo={row.bestCombined} />
                <UserMarketEvalCell evalRow={row.userMarketEval} />
              </div>
            )}
          </button>
        </td>
      </tr>
    </>
  );
}

export function DecisionMakerApp() {
  const {
    ready,
    error,
    batches,
    comboSettings,
    analysis,
    teamsQuality,
    learnerStats,
    leaguePriors,
  } = usePredictionLogData();

  const [batchId, setBatchId] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const sortedBatches = useMemo(
    () =>
      [...batches].sort(
        (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
      ),
    [batches]
  );

  useEffect(() => {
    if (!batchId && sortedBatches[0]) setBatchId(sortedBatches[0].id);
  }, [sortedBatches, batchId]);

  const batch = sortedBatches.find((b) => b.id === batchId) ?? null;

  const decisions = useMemo(() => {
    if (!batch) return [] as MatchDecisionRow[];
    return processBatchDecisions({
      batch,
      allBatches: batches,
      comboSettings,
      analysis,
      teamsQuality,
      learnerStats,
      leaguePriors,
    });
  }, [batch, batches, comboSettings, analysis, teamsQuality, learnerStats, leaguePriors]);

  const registry = listRegisteredResultPages();

  if (!ready) {
    return <p className="page-sub">Loading decision sources…</p>;
  }

  if (error) {
    return <div className="alert alert-error">{error}</div>;
  }

  return (
    <div>
      <h1 className="page-title">Batch Decision Maker</h1>
      <p className="page-sub">
        Exactly five decisions per match: three system markets, one mandatory Combination Odd, and
        one user-market evaluation. Never drops fixtures.
      </p>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: 6 }}>
          Batch
        </label>
        <select
          className="input"
          value={batchId}
          onChange={(e) => setBatchId(e.target.value)}
          style={{ maxWidth: 480 }}
        >
          {sortedBatches.length === 0 && <option value="">No batches</option>}
          {sortedBatches.map((b) => (
            <option key={b.id} value={b.id}>
              {getBatchDisplayId(b)} · {b.date} · {b.matches.length} matches
              {b.batchKind === "recommended" ? " · reco" : ""}
            </option>
          ))}
        </select>
        <div
          style={{
            marginTop: "0.75rem",
            fontSize: "0.75rem",
            color: "var(--muted)",
            lineHeight: 1.5,
          }}
        >
          Sources ({registry.length}):{" "}
          {registry.map((p) => p.pageLabel).join(" · ")}
        </div>
      </div>

      {!batch ? (
        <p className="page-sub">Select a batch to generate decisions.</p>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              marginBottom: "0.75rem",
              fontSize: "0.8rem",
              color: "var(--muted)",
            }}
          >
            <span>
              Matches: <strong style={{ color: "var(--text)" }}>{decisions.length}</strong>
              {" / "}
              {batch.matches.length}
            </span>
            <span>
              Incomplete:{" "}
              <strong style={{ color: "var(--text)" }}>
                {decisions.filter((d) => d.incomplete).length}
              </strong>
            </span>
          </div>

          <div className="table-wrap">
            <table className="data-table dm-table" style={{ minWidth: 1400 }}>
              <thead>
                <tr>
                  <th>Match</th>
                  <th>League</th>
                  <th>Date/Time</th>
                  <th>1st Best Market</th>
                  <th>2nd Best Market</th>
                  <th>3rd Best Market</th>
                  <th>Mandatory Combination Odd</th>
                  <th>User Market Evaluation</th>
                  <th>Confidence Score</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((row) => (
                  <DecisionRow
                    key={row.match.id}
                    row={row}
                    batchDate={batch.date}
                    expanded={!!expanded[row.match.id]}
                    onToggle={() =>
                      setExpanded((prev) => ({
                        ...prev,
                        [row.match.id]: !prev[row.match.id],
                      }))
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
