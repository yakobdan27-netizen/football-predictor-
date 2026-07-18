"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  pickBatchBestHsh,
  type HshConfidence,
  type HshPrediction,
} from "@/lib/prediction-log/hsh-model";
import { usePredictionLogData } from "./use-prediction-log-data";
import { useHshPredictions } from "./use-hsh-predictions";

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function confidenceStyle(c: HshConfidence): CSSProperties {
  switch (c) {
    case "high":
      return { background: "rgba(34, 197, 94, 0.2)", color: "#15803d" };
    case "medium":
      return { background: "rgba(245, 158, 11, 0.2)", color: "#b45309" };
    default:
      return { background: "var(--surface2)", color: "var(--muted)" };
  }
}

function confidenceNote(c: HshConfidence, margin: number, seedOnly: boolean): string {
  if (seedOnly) return "Low — either club is seed-only (label only; match stays in batch)";
  if (c === "high") return "High — margin ≥15% and both clubs have ≥3 seasons";
  if (c === "medium") return "Medium — margin between 7% and 15%";
  if (margin < 0.07) return "Low — margin under 7%";
  return "Low confidence (advisory only)";
}

export function HshApp() {
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
  const { predictions, loading, error: predError } = useHshPredictions(batch, batches, {});

  const summary = useMemo(() => {
    if (!predictions.length) return null;
    const counts = { "1H": 0, "2H": 0, Tie: 0 };
    for (const p of predictions) counts[p.recommended] += 1;
    return counts;
  }, [predictions]);

  const batchBest = useMemo(() => pickBatchBestHsh(predictions), [predictions]);

  if (!ready) {
    return <p className="page-sub">Loading…</p>;
  }

  return (
    <div>
      {(error || predError) && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error ?? predError}
        </div>
      )}

      <div style={{ marginBottom: "1.25rem" }}>
        <h1 className="page-title">Highest Scoring Half</h1>
        <p className="page-sub">
          Attack × defence per half (1H / 2H / Tie) — advisory only, never blocks a pick.
        </p>
      </div>

      <div
        className="card"
        style={{
          marginBottom: "1rem",
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
          alignItems: "center",
        }}
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
            Recs: 1H {summary["1H"]} · 2H {summary["2H"]} · Tie {summary.Tie}
            {loading ? " · updating…" : ""}
          </p>
        )}
      </div>

      {batchBest && (
        <div
          className="alert"
          style={{
            marginBottom: "1rem",
            background: "rgba(34, 197, 94, 0.12)",
            border: "1px solid rgba(34, 197, 94, 0.35)",
            color: "var(--text)",
          }}
        >
          Batch-best (advisory): <strong>{batchBest.homeTeam} vs {batchBest.awayTeam}</strong>
          {" — "}
          {batchBest.recommended} ({pct(batchBest.topProbability)}, {batchBest.confidence}) · E[D]{" "}
          {batchBest.expectedDiff.toFixed(2)}
        </div>
      )}

      {!batch ? (
        <p className="page-sub">Select a saved batch to run highest-scoring-half predictions.</p>
      ) : predictions.length === 0 ? (
        <p className="page-sub">This batch has no matches.</p>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table" style={{ width: "100%", fontSize: "0.8125rem" }}>
            <thead>
              <tr>
                <th>Match</th>
                <th>λ 1H</th>
                <th>λ 2H</th>
                <th>P(1H)</th>
                <th>P(2H)</th>
                <th>P(Tie)</th>
                <th>E[D]</th>
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
  prediction: HshPrediction;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer" }} title="Click for detail">
        <td>
          {p.homeTeam} vs {p.awayTeam}
        </td>
        <td>{p.lambda1h.toFixed(2)}</td>
        <td>{p.lambda2h.toFixed(2)}</td>
        <td>{pct(p.p1h)}</td>
        <td>{pct(p.p2h)}</td>
        <td>{pct(p.pTie)}</td>
        <td>
          {p.expectedDiff.toFixed(2)}
          <span style={{ color: "var(--muted)", marginLeft: "0.25rem" }}>
            ±{p.seDiff.toFixed(2)}
          </span>
        </td>
        <td>
          <strong>{p.recommended}</strong>
        </td>
        <td>
          <span className="badge" style={confidenceStyle(p.confidence)}>
            {p.confidence}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} style={{ background: "var(--surface2)", padding: "1rem" }}>
            <DetailPanel prediction={p} />
          </td>
        </tr>
      )}
    </>
  );
}

function DetailPanel({ prediction: p }: { prediction: HshPrediction }) {
  const d = p.detail;
  const lowSeedHint =
    (d.seedHome != null && !d.seedHome.includes("live")) ||
    (d.seedAway != null && !d.seedAway.includes("live"));

  return (
    <div style={{ display: "grid", gap: "0.5rem", fontSize: "0.8125rem" }}>
      <strong>
        {p.homeTeam} vs {p.awayTeam}
      </strong>
      <div>
        Team-half λ: {p.homeTeam} 1H {d.lambdaA1.toFixed(2)} · 2H {d.lambdaA2.toFixed(2)} ·{" "}
        {p.awayTeam} 1H {d.lambdaB1.toFixed(2)} · 2H {d.lambdaB2.toFixed(2)}
      </div>
      <div>
        Match totals: Λ1 {p.lambda1h.toFixed(2)} · Λ2 {p.lambda2h.toFixed(2)}
        {d.couplingApplied ? " · 2H coupling on" : ""}
      </div>
      <div>
        Skellam: E[D] {p.expectedDiff.toFixed(2)} · SE {p.seDiff.toFixed(2)} · margin{" "}
        {(p.margin * 100).toFixed(0)} pts
      </div>
      <div>
        Coeffs (att/def 1H→2H): home {d.att1Home.toFixed(2)}/{d.def1Home.toFixed(2)} →{" "}
        {d.att2Home.toFixed(2)}/{d.def2Home.toFixed(2)} · away {d.att1Away.toFixed(2)}/
        {d.def1Away.toFixed(2)} → {d.att2Away.toFixed(2)}/{d.def2Away.toFixed(2)} · Lg AF{" "}
        {d.lgAf1.toFixed(2)}/{d.lgAf2.toFixed(2)}
      </div>
      <div>
        Samples: home {p.sampleSizeHome} · away {p.sampleSizeAway}
      </div>
      {(d.seedHome || d.seedAway) && (
        <div style={{ color: "var(--muted)" }}>
          Rates: {[d.seedHome, d.seedAway].filter(Boolean).join(" · ")}
        </div>
      )}
      <div>
        Probabilities: P(1H) {pct(p.p1h)} · P(2H) {pct(p.p2h)} · P(Tie) {pct(p.pTie)}
      </div>
      <div>
        Recommendation: <strong>{p.recommended}</strong> ({p.confidence}) —{" "}
        {confidenceNote(p.confidence, p.margin, lowSeedHint && p.confidence === "low")}
      </div>
      {p.confidence === "low" && (
        <p style={{ margin: "0.25rem 0 0", color: "var(--warn)" }}>
          Low confidence warning — confirm if you still want this market. Match stays in the batch;
          nothing is blocked.
        </p>
      )}
    </div>
  );
}
