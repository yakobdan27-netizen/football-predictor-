"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  recommendationLabel,
  type HcConfidence,
  type HcPrediction,
} from "@/lib/prediction-log/half-comparison-model";
import { usePredictionLogData } from "./use-prediction-log-data";
import { useHalfComparisonPredictions } from "./use-half-comparison-predictions";

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function confidenceStyle(c: HcConfidence): CSSProperties {
  switch (c) {
    case "very_high":
    case "high":
      return { background: "rgba(34, 197, 94, 0.2)", color: "#15803d" };
    case "moderate":
      return { background: "rgba(245, 158, 11, 0.2)", color: "#b45309" };
    default:
      return { background: "var(--surface2)", color: "var(--muted)" };
  }
}

function tempoLabel(isFast: boolean, isLate: boolean, pace: number | null): string {
  if (isFast && pace != null) return `Fast starter (pace ~${Math.round(pace)}min)`;
  if (isFast) return "Fast starter";
  if (isLate) return "Strong finisher (late surge)";
  if (pace != null) return `Moderate (pace ~${Math.round(pace)}min)`;
  return "Limited tempo data";
}

export function HalfComparisonApp() {
  const { ready, error, batches } = usePredictionLogData();
  const sortedBatches = useMemo(
    () => [...batches].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [batches]
  );
  const [batchId, setBatchId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!batchId && sortedBatches[0]) setBatchId(sortedBatches[0].id);
  }, [sortedBatches, batchId]);

  const batch = sortedBatches.find((b) => b.id === batchId) ?? null;
  const { predictions } = useHalfComparisonPredictions(batch, batches);

  const summary = useMemo(() => {
    if (!predictions.length) return null;
    const counts = { "1h_greater": 0, equal: 0, "2h_greater": 0 };
    for (const p of predictions) counts[p.recommendation] += 1;
    return counts;
  }, [predictions]);

  if (!ready) {
    return <p className="page-sub">Loading…</p>;
  }

  return (
    <div>
      {error && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <div style={{ marginBottom: "1.25rem" }}>
        <h1 className="page-title">Half Comparison Analysis</h1>
        <p className="page-sub">
          Predicting: 1H &gt; 2H | 1H = 2H | 2H &gt; 1H — advisory only, never blocks a pick.
        </p>
      </div>

      <div
        className="card"
        style={{ marginBottom: "1rem", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}
      >
        <label style={{ fontSize: "0.8125rem", fontWeight: 600 }}>
          Batch
          <select
            className="select"
            style={{ display: "block", marginTop: "0.25rem", minWidth: "16rem" }}
            value={batchId}
            onChange={(e) => {
              setBatchId(e.target.value);
              setExpandedId(null);
            }}
          >
            {sortedBatches.length === 0 && <option value="">No batches</option>}
            {sortedBatches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.batchName} ({b.date}) · {b.matches.length} matches
              </option>
            ))}
          </select>
        </label>
        {summary && (
          <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: 0 }}>
            Recs: 1H more {summary["1h_greater"]} · Equal {summary.equal} · 2H more {summary["2h_greater"]}
          </p>
        )}
      </div>

      {!batch ? (
        <p className="page-sub">Select a saved batch to run half comparison.</p>
      ) : predictions.length === 0 ? (
        <p className="page-sub">This batch has no matches.</p>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table" style={{ width: "100%", fontSize: "0.8125rem" }}>
            <thead>
              <tr>
                <th>Match</th>
                <th>Exp 1H</th>
                <th>Exp 2H</th>
                <th>P(1H&gt;2H)</th>
                <th>P(1H=2H)</th>
                <th>P(2H&gt;1H)</th>
                <th>Recommendation</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {predictions.map((p) => (
                <PredictionRow
                  key={p.matchId}
                  prediction={p}
                  expanded={expandedId === p.matchId}
                  onToggle={() =>
                    setExpandedId((id) => (id === p.matchId ? null : p.matchId))
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PredictionRow({
  prediction: p,
  expanded,
  onToggle,
}: {
  prediction: HcPrediction;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        style={{ cursor: "pointer" }}
        title="Click for detail"
      >
        <td>
          {p.homeTeam} vs {p.awayTeam}
        </td>
        <td>{p.exp1h.toFixed(2)}</td>
        <td>{p.exp2h.toFixed(2)}</td>
        <td>{pct(p.p1hGreater)}</td>
        <td>{pct(p.pEqual)}</td>
        <td>{pct(p.p2hGreater)}</td>
        <td>{recommendationLabel(p.recommendation)}</td>
        <td>
          <span className="badge" style={confidenceStyle(p.confidence)}>
            {p.confidence.replace("_", " ")}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} style={{ background: "var(--surface2)", padding: "1rem" }}>
            <DetailPanel prediction={p} />
          </td>
        </tr>
      )}
    </>
  );
}

function DetailPanel({ prediction: p }: { prediction: HcPrediction }) {
  const d = p.detail;
  return (
    <div style={{ display: "grid", gap: "0.5rem", fontSize: "0.8125rem" }}>
      <strong>
        {p.homeTeam} vs {p.awayTeam}
      </strong>
      <div>
        Expected 1H: {p.exp1h.toFixed(2)} · Expected 2H: {p.exp2h.toFixed(2)}
      </div>
      <div>
        Home 1H profile: {tempoLabel(d.homeTempo.isFastStarter, d.homeTempo.isLateSurger, d.homeTempo.paceProxy)}
        {d.homeAvg1h > 0 || d.homeAvg2h > 0
          ? ` · avg ${d.homeAvg1h.toFixed(2)} / ${d.homeAvg2h.toFixed(2)} (n=${p.sampleSizeHome})`
          : ""}
      </div>
      <div>
        Away 1H profile: {tempoLabel(d.awayTempo.isFastStarter, d.awayTempo.isLateSurger, d.awayTempo.paceProxy)}
        {d.awayAvg1h > 0 || d.awayAvg2h > 0
          ? ` · avg ${d.awayAvg1h.toFixed(2)} / ${d.awayAvg2h.toFixed(2)} (n=${p.sampleSizeAway})`
          : ""}
      </div>
      <div>
        League anchor: {d.leagueAvg1h.toFixed(2)} / {d.leagueAvg2h.toFixed(2)}
        {d.tempoBoost1h ? " · tempo +1H" : ""}
        {d.lateSurgeBoost2h ? " · late surge +2H" : ""}
        {d.fatigueBoost2h ? " · fatigue +2H" : ""}
      </div>
      {(d.baselineHome || d.baselineAway || d.baselineLeague) && (
        <div style={{ color: "var(--muted)" }}>
          Cold-start: {[d.baselineHome, d.baselineAway, d.baselineLeague].filter(Boolean).join(" · ")}
        </div>
      )}
      <div style={{ marginTop: "0.25rem" }}>
        Probabilities: P(1H&gt;2H) {pct(p.p1hGreater)} · P(=) {pct(p.pEqual)} · P(2H&gt;1H){" "}
        {pct(p.p2hGreater)}
      </div>
      <div>
        Recommendation: {recommendationLabel(p.recommendation)} ({p.confidence.replace("_", " ")})
      </div>
      <p style={{ margin: "0.25rem 0 0", color: "var(--muted)" }}>{p.tacticalNote}</p>
      {(p.confidence === "low") && (
        <p style={{ margin: "0.25rem 0 0", color: "var(--warn)" }}>
          Low confidence warning — confirm if you still want this market. Match stays in the batch;
          nothing is blocked.
        </p>
      )}
      {p.valueAlert && (
        <p style={{ margin: 0, color: "var(--warning, #b45309)" }}>
          Value alert: First-half dominance probability ({pct(p.p1hGreater)}) is above 30% —
          advisory only; no market odds comparison in v1.
        </p>
      )}
    </div>
  );
}
