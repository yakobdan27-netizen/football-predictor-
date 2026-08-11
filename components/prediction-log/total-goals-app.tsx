"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { usePredictionLogData } from "./use-prediction-log-data";
import { useHalfParamsCache } from "./use-half-params-cache";
import {
  useTotalGoalsPredictions,
  type TotalGoalsRow,
} from "./use-total-goals-predictions";
import { FixtureEstimateDiagnostics } from "./fixture-estimate-diagnostics";
import { matchLeague } from "@/lib/prediction-log/match-league";
import {
  TOTAL_GOALS_LINES,
  type TotalGoalsLine,
} from "@/lib/prediction-log/total-goals-markets";
import {
  BlendedAnalysisNotice,
  pickBlendFromEstimates,
} from "@/components/analysis/blended-analysis-notice";

type SortKey =
  | "expected"
  | "kickoff"
  | "confidence"
  | `over_${TotalGoalsLine}`
  | `under_${TotalGoalsLine}`;

const CONF_ORDER = { high: 0, medium: 1, low: 2 } as const;

function pct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

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

export function TotalGoalsApp() {
  const { ready, error, batches } = usePredictionLogData();
  const { store: halfStore, loading: halfLoading, error: halfError } =
    useHalfParamsCache();
  const [batchId, setBatchId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("expected");

  const sortedBatches = useMemo(
    () =>
      [...batches].sort(
        (a, b) =>
          b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
      ),
    [batches]
  );

  useEffect(() => {
    if (!batchId && sortedBatches[0]) setBatchId(sortedBatches[0].id);
  }, [sortedBatches, batchId]);

  const batch = sortedBatches.find((b) => b.id === batchId) ?? null;
  const { rows, estimatesById } = useTotalGoalsPredictions(
    batch,
    batches,
    halfStore
  );
  const blendNotice = useMemo(
    () => pickBlendFromEstimates(estimatesById),
    [estimatesById]
  );

  const leagues = useMemo(() => {
    if (!batch) return [] as string[];
    const set = new Set<string>();
    for (const m of batch.matches) set.add(matchLeague(m, batch.league));
    return [...set].sort();
  }, [batch]);

  const filteredSorted = useMemo(() => {
    let list = rows;
    if (leagueFilter !== "all" && batch) {
      const allow = new Set(
        batch.matches
          .filter((m) => matchLeague(m, batch.league) === leagueFilter)
          .map((m) => m.id)
      );
      list = list.filter((r) => allow.has(r.matchId));
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortKey === "expected") {
        return b.totalGoals.expectedTotal - a.totalGoals.expectedTotal;
      }
      if (sortKey === "kickoff") return a.kickoff.localeCompare(b.kickoff);
      if (sortKey === "confidence") {
        return CONF_ORDER[a.confidence] - CONF_ORDER[b.confidence];
      }
      if (sortKey.startsWith("over_")) {
        const line = Number(sortKey.slice(5)) as TotalGoalsLine;
        return (
          (b.totalGoals.lines[line]?.over ?? 0) -
          (a.totalGoals.lines[line]?.over ?? 0)
        );
      }
      if (sortKey.startsWith("under_")) {
        const line = Number(sortKey.slice(6)) as TotalGoalsLine;
        return (
          (b.totalGoals.lines[line]?.under ?? 0) -
          (a.totalGoals.lines[line]?.under ?? 0)
        );
      }
      return 0;
    });
    return sorted;
  }, [rows, leagueFilter, sortKey, batch]);

  if (!ready || halfLoading) {
    return <p className="page-sub">Loading…</p>;
  }

  return (
    <div>
      {(error || halfError) && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error ?? halfError}
        </div>
      )}

      <BlendedAnalysisNotice blend={blendNotice} pageLabel="Total Goals" />

      <div style={{ marginBottom: "1.25rem" }}>
        <h1 className="page-title">Total Goals</h1>
        <p className="page-sub">
          Full-match goals by both teams at 90 minutes (stoppage included; no
          extra time / penalties). Distribution from the canonical FT score
          matrix (Dixon–Coles), or NegBin when the competition is overdispersed.
          Advisory only — never blocks a pick.
        </p>
      </div>

      <div
        className="card"
        style={{
          marginBottom: "1rem",
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
          alignItems: "flex-end",
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
        <label style={{ fontSize: "0.8125rem", fontWeight: 600 }}>
          League
          <select
            className="select"
            style={{ display: "block", marginTop: "0.25rem", minWidth: "10rem" }}
            value={leagueFilter}
            onChange={(e) => setLeagueFilter(e.target.value)}
          >
            <option value="all">All</option>
            {leagues.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: "0.8125rem", fontWeight: 600 }}>
          Sort
          <select
            className="select"
            style={{ display: "block", marginTop: "0.25rem", minWidth: "12rem" }}
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <option value="expected">Expected total</option>
            <option value="over_1.5">Over 1.5</option>
            <option value="under_1.5">Under 1.5</option>
            <option value="over_2.5">Over 2.5</option>
            <option value="under_2.5">Under 2.5</option>
            <option value="over_3.5">Over 3.5</option>
            <option value="under_3.5">Under 3.5</option>
            <option value="kickoff">Kick-off</option>
            <option value="confidence">Confidence tier</option>
          </select>
        </label>
      </div>

      {!batch ? (
        <p className="page-sub">Select a saved batch.</p>
      ) : filteredSorted.length === 0 ? (
        <p className="page-sub">No matches for this filter.</p>
      ) : (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <table
            className="table mobile-stack-table"
            style={{ width: "100%", fontSize: "0.8125rem" }}
          >
            <thead>
              <tr>
                <th>Match</th>
                <th>E[T]</th>
                <th>Mode</th>
                <th>O1.5</th>
                <th>O2.5</th>
                <th>O3.5</th>
                <th>Family</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map((row) => (
                <TgRowView
                  key={row.matchId}
                  row={row}
                  expanded={expandedId === row.matchId}
                  onToggle={() =>
                    setExpandedId((id) =>
                      id === row.matchId ? null : row.matchId
                    )
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

function TgRowView({
  row,
  expanded,
  onToggle,
}: {
  row: TotalGoalsRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const tg = row.totalGoals;
  return (
    <>
      <tr
        onClick={onToggle}
        style={{ cursor: "pointer" }}
        data-expanded={expanded ? "true" : undefined}
      >
        <td>
          <strong>
            {row.homeTeam} vs {row.awayTeam}
          </strong>
          <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
            {row.kickoff}
          </div>
        </td>
        <td>{tg.expectedTotal.toFixed(2)}</td>
        <td>{tg.mode >= 8 ? "8+" : tg.mode}</td>
        <td>{pct(tg.lines[1.5].over)}</td>
        <td>
          <strong>{pct(tg.lines[2.5].over)}</strong>
        </td>
        <td>{pct(tg.lines[3.5].over)}</td>
        <td style={{ textTransform: "uppercase", fontSize: "0.7rem" }}>
          {tg.distributionFamily}
        </td>
        <td>
          <span
            style={{
              ...confidenceStyle(row.confidence),
              padding: "0.15rem 0.45rem",
              borderRadius: 4,
              fontSize: "0.7rem",
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            {row.confidence}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} style={{ background: "var(--surface2)" }}>
            <TgDetail row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

function TgDetail({ row }: { row: TotalGoalsRow }) {
  const tg = row.totalGoals;
  const prov = row.estimate.provenance;
  const maxP = Math.max(...tg.pmf, 1e-9);

  return (
    <div style={{ padding: "0.75rem", fontSize: "0.8125rem" }}>
      <p style={{ margin: "0 0 0.5rem", color: "var(--muted)" }}>
        Source: {prov.sourceBreakdown} · API {prov.api_pct.toFixed(0)}% / manual{" "}
        {prov.manual_pct.toFixed(0)}% · λ {row.estimate.lambdas.home.toFixed(2)}{" "}
        / {row.estimate.lambdas.away.toFixed(2)} · family{" "}
        {tg.distributionFamily}
        {tg.dispersion != null ? ` (φ=${tg.dispersion.toFixed(2)})` : ""} · 50%
        CI [{tg.ci50[0]}, {tg.ci50[1] >= 8 ? "8+" : tg.ci50[1]}]
      </p>

      <div style={{ marginBottom: "0.75rem" }}>
        <div style={{ fontWeight: 600, marginBottom: "0.35rem" }}>
          O/U ladder (0.5–6.5)
        </div>
        <table className="table" style={{ width: "100%", maxWidth: "28rem" }}>
          <thead>
            <tr>
              <th>Line</th>
              <th>Over</th>
              <th>Under</th>
            </tr>
          </thead>
          <tbody>
            {TOTAL_GOALS_LINES.map((line) => (
              <tr key={line}>
                <td>{line}</td>
                <td>{pct(tg.lines[line].over)}</td>
                <td>{pct(tg.lines[line].under)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginBottom: "0.75rem" }}>
        <div style={{ fontWeight: 600, marginBottom: "0.35rem" }}>
          Exact total
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 4,
            height: 72,
          }}
        >
          {tg.pmf.map((p, k) => (
            <div
              key={k}
              title={`${k >= 8 ? "8+" : k}: ${pct(p)}`}
              style={{
                flex: 1,
                maxWidth: 36,
                height: `${Math.max(4, (p / maxP) * 64)}px`,
                background: "var(--accent, #2563eb)",
                opacity: 0.75,
                borderRadius: 2,
              }}
            />
          ))}
        </div>
        <div
          style={{
            display: "flex",
            gap: 4,
            fontSize: "0.65rem",
            color: "var(--muted)",
          }}
        >
          {tg.pmf.map((_, k) => (
            <div key={k} style={{ flex: 1, maxWidth: 36, textAlign: "center" }}>
              {k >= 8 ? "8+" : k}
            </div>
          ))}
        </div>
      </div>

      <FixtureEstimateDiagnostics estimate={row.estimate} />
    </div>
  );
}
