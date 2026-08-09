"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { usePredictionLogData } from "./use-prediction-log-data";
import { useHalfParamsCache } from "./use-half-params-cache";
import { useDiehPredictions, type DiehRow } from "./use-dieh-predictions";
import { FixtureEstimateDiagnostics } from "./fixture-estimate-diagnostics";
import { HistCoverageBadge } from "./hist-coverage-badge";
import { matchLeague } from "@/lib/prediction-log/match-league";

type SortKey =
  | "yes"
  | "no"
  | "kickoff"
  | "confidence"
  | "pD1"
  | "pD2";

const CONF_ORDER = { high: 0, medium: 1, low: 2 } as const;

function pct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
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

export function DiehApp() {
  const { ready, error, batches } = usePredictionLogData();
  const { store: halfStore, loading: halfLoading, error: halfError } =
    useHalfParamsCache();
  const [batchId, setBatchId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("yes");
  const [showCal, setShowCal] = useState(false);

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
  const { rows } = useDiehPredictions(batch, batches, halfStore);

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
      switch (sortKey) {
        case "yes":
          return (b.dieh.diehYes ?? -1) - (a.dieh.diehYes ?? -1);
        case "no":
          return (b.dieh.diehNo ?? -1) - (a.dieh.diehNo ?? -1);
        case "pD1":
          return (b.dieh.pD1 ?? -1) - (a.dieh.pD1 ?? -1);
        case "pD2":
          return (b.dieh.pD2 ?? -1) - (a.dieh.pD2 ?? -1);
        case "kickoff":
          return a.kickoff.localeCompare(b.kickoff);
        case "confidence":
          return CONF_ORDER[a.confidence] - CONF_ORDER[b.confidence];
        default:
          return 0;
      }
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

      <div style={{ marginBottom: "1.25rem" }}>
        <h1 className="page-title">Draw in Either Half</h1>
        <p className="page-sub">
          Settles YES if the first half ends level <em>or</em> the second half
          (isolated 46′–90′) ends level — including 0-0. This is{" "}
          <strong>not</strong> half-time draw and <strong>not</strong> HT/FT
          draw. Half rates come from historical HT/FT shares, never by halving
          full-match λ. Advisory only — never blocks a pick.
        </p>
        <HistCoverageBadge />
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
            style={{ display: "block", marginTop: "0.25rem", minWidth: "10rem" }}
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <option value="yes">YES probability</option>
            <option value="no">NO probability</option>
            <option value="pD1">First-half level</option>
            <option value="pD2">Second-half level</option>
            <option value="kickoff">Kick-off</option>
            <option value="confidence">Confidence tier</option>
          </select>
        </label>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setShowCal((v) => !v)}
        >
          {showCal ? "Hide" : "Show"} model calibration
        </button>
        {showCal && (
          <div className="card" style={{ marginTop: "0.75rem", fontSize: "0.8125rem" }}>
            <p className="page-sub" style={{ marginTop: 0 }}>
              Reliability / Brier from held-out seasons. Run{" "}
              <code>npx tsx scripts/backtest-dieh.ts</code> after hist backfill
              to refresh. Thin samples show honest gaps — figures are not hidden
              when miscalibrated.
            </p>
            {halfStore && halfStore.leagues.length > 0 ? (
              <table className="table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>Competition</th>
                    <th>n valid</th>
                    <th>s₁</th>
                    <th>κ_adj</th>
                  </tr>
                </thead>
                <tbody>
                  {halfStore.leagues.map((l) => (
                    <tr key={`${l.leagueId}:${l.compType}`}>
                      <td>
                        {l.leagueName} ({l.compType})
                      </td>
                      <td>{l.nValid}</td>
                      <td>{l.s1.toFixed(3)}</td>
                      <td>{l.kappaAdj.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="page-sub">
                No fitted half params yet. Run{" "}
                <code>npx tsx scripts/fit-half-params.ts</code>.
              </p>
            )}
          </div>
        )}
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
                <th>1H level</th>
                <th>2H level</th>
                <th>Both level</th>
                <th>DIEH YES</th>
                <th>DIEH NO</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map((row) => (
                <DiehRowView
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

function DiehRowView({
  row,
  expanded,
  onToggle,
}: {
  row: DiehRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const d = row.dieh;
  const insufficient = d.status === "insufficient";
  const errored = d.status === "error";

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
        {insufficient || errored ? (
          <td colSpan={5}>
            <span style={{ color: errored ? "var(--danger, #b91c1c)" : "var(--muted)" }}>
              {errored
                ? `ERROR: ${d.errorState ?? "sanity bound failed"}`
                : d.message ?? "INSUFFICIENT HALF-TIME DATA"}
            </span>
          </td>
        ) : (
          <>
            <td>{pct(d.pD1)}</td>
            <td>{pct(d.pD2)}</td>
            <td>{pct(d.pD1AndD2)}</td>
            <td>
              <strong>{pct(d.diehYes)}</strong>
            </td>
            <td>{pct(d.diehNo)}</td>
          </>
        )}
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
          <td colSpan={7} style={{ background: "var(--surface2)" }}>
            <DetailPanel row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

function DetailPanel({ row }: { row: DiehRow }) {
  const d = row.dieh;
  const hl = d.halfLambdas;
  const shares = d.halfShares;
  const prov = row.estimate.provenance;

  return (
    <div style={{ padding: "0.75rem", fontSize: "0.8125rem" }}>
      <p style={{ margin: "0 0 0.5rem", color: "var(--muted)" }}>
        Source: {prov.sourceBreakdown} · API {prov.api_pct.toFixed(0)}% / manual{" "}
        {prov.manual_pct.toFixed(0)}% · FT λ {row.estimate.lambdas.home.toFixed(2)} /{" "}
        {row.estimate.lambdas.away.toFixed(2)}
      </p>
      {hl && shares && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))",
            gap: "0.5rem",
            marginBottom: "0.75rem",
          }}
        >
          <div>
            <div style={{ color: "var(--muted)" }}>Half λ</div>
            <div>
              1H {hl.home1.toFixed(3)} / {hl.away1.toFixed(3)}
            </div>
            <div>
              2H {hl.home2.toFixed(3)} / {hl.away2.toFixed(3)}
            </div>
          </div>
          <div>
            <div style={{ color: "var(--muted)" }}>Shares (s₁)</div>
            <div>combined {shares.s1Combined.toFixed(3)}</div>
            <div>
              home {shares.s1Home.toFixed(3)}
              {shares.usedCombinedShareHome ? " (fallback)" : ""}
            </div>
            <div>
              away {shares.s1Away.toFixed(3)}
              {shares.usedCombinedShareAway ? " (fallback)" : ""}
            </div>
            <div>n={d.nValid}</div>
          </div>
          <div>
            <div style={{ color: "var(--muted)" }}>Dependence κ</div>
            <div>κ_adj {d.kappaAdj?.toFixed(3) ?? "—"}</div>
            <div>κ_raw {d.kappaRaw?.toFixed(3) ?? "—"}</div>
            <div>n={d.nValid}</div>
          </div>
        </div>
      )}
      <FixtureEstimateDiagnostics estimate={row.estimate} />
    </div>
  );
}
