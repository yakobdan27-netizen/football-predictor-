"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  buildLadder,
  LADDER_CONFIG,
  legsForRound,
  shortLeagueLabel,
  suggestStakeSplit,
  type LadderRound,
  type RiskExposure,
} from "@/lib/prediction-log/ladder";
import { reloadBatchesFromServer } from "@/lib/prediction-log/storage";
import { usePredictionLogData } from "./use-prediction-log-data";
import { useTwoHHeavyRanking } from "./use-two-h-heavy-ranking";

const HONESTY_BANNER =
  "This ladder lowers the chance of losing everything — it does NOT guarantee a win. Spreading across rounds reduces wipeout risk but also reduces total payout, because safer rounds (fewer legs) pay less. Losing one match knocks out only the rounds that include it; rounds that already dropped it can still land. All probabilities are model estimates, not certainties.";

function riskBadgeStyle(r: RiskExposure): CSSProperties {
  switch (r) {
    case "HIGH":
      return { background: "rgba(185, 28, 28, 0.15)", color: "#b91c1c" };
    case "Medium":
      return { background: "rgba(245, 158, 11, 0.2)", color: "#b45309" };
    case "Very Low":
      return { background: "rgba(34, 197, 94, 0.22)", color: "#15803d" };
    default:
      return { background: "rgba(34, 197, 94, 0.14)", color: "#166534" };
  }
}

function riskLabel(r: RiskExposure): string {
  switch (r) {
    case "HIGH":
      return "HIGH";
    case "Medium":
      return "Medium";
    case "Very Low":
      return "Very Low";
    default:
      return "Low";
  }
}

function matchHref(batchId: string, apiFixtureId?: number): string {
  if (apiFixtureId != null && Number.isFinite(apiFixtureId)) {
    return `/decision-maker?batch=${encodeURIComponent(batchId)}&fixture_id=${apiFixtureId}`;
  }
  return `/decision-maker?batch=${encodeURIComponent(batchId)}`;
}

export function LadderApp() {
  const { ready, error, batches, refresh } = usePredictionLogData();
  const sortedBatches = useMemo(
    () =>
      [...batches].sort(
        (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
      ),
    [batches]
  );

  const [batchId, setBatchId] = useState("");
  const [expandedRound, setExpandedRound] = useState<number | null>(1);
  const [bankrollInput, setBankrollInput] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [confFloor, setConfFloor] = useState(LADDER_CONFIG.CONF_FLOOR);
  const [maxPerLeague, setMaxPerLeague] = useState(LADDER_CONFIG.MAX_PER_LEAGUE);
  const [whyOpen, setWhyOpen] = useState(false);

  useEffect(() => {
    if (!batchId && sortedBatches[0]) setBatchId(sortedBatches[0].id);
  }, [sortedBatches, batchId]);

  const batch = sortedBatches.find((b) => b.id === batchId) ?? null;
  const { ranked, loading } = useTwoHHeavyRanking(batch, batches, { refreshToken });

  const ladder = useMemo(() => {
    if (!batch) return null;
    return buildLadder({
      ranked,
      batch,
      confFloor,
      maxPerLeague,
    });
  }, [ranked, batch, confFloor, maxPerLeague]);

  const bankroll = useMemo(() => {
    const n = Number.parseFloat(bankrollInput);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [bankrollInput]);

  const stakes = useMemo(() => {
    if (bankroll == null || !ladder) return null;
    return suggestStakeSplit(bankroll, ladder.rounds);
  }, [bankroll, ladder]);

  const distStrip = useMemo(() => {
    if (!ladder?.selection.leagueCounts) return [];
    return Object.entries(ladder.selection.leagueCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([league, count]) => ({
        league,
        label: shortLeagueLabel(league),
        count,
      }));
  }, [ladder]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await reloadBatchesFromServer();
      await refresh();
      setRefreshToken((t) => t + 1);
    } finally {
      setRefreshing(false);
    }
  }

  if (!ready) {
    return <p className="page-sub">Loading…</p>;
  }

  return (
    <div className="ladder-page">
      {error && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <div style={{ marginBottom: "1rem" }}>
        <h1 className="page-title">Survival Ladder (2H &gt; 1H)</h1>
        <p className="page-sub">
          Round-reduction parlays from floor-passing matches, spread across leagues. Read-only —
          never blocks a bet.
        </p>
      </div>

      <div className="alert ladder-honesty-banner" role="status">
        <strong>Honesty:</strong> {HONESTY_BANNER}
      </div>

      <p className="ladder-payout-note">
        <strong>Payout vs. Safety:</strong> R1 (most legs) = highest potential payout, lowest hit rate.
        Later rounds (fewer legs) = lower payout, higher hit rate. Diversifying legs across leagues
        makes this independence estimate more realistic, but correlation is never zero.
      </p>

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
              setExpandedRound(1);
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
          Ladder bankroll (optional)
          <input
            className="input"
            type="number"
            min={0}
            step={1}
            placeholder="Leave blank to hide stakes"
            value={bankrollInput}
            onChange={(e) => setBankrollInput(e.target.value)}
            style={{ display: "block", marginTop: "0.25rem", width: "12rem" }}
          />
        </label>

        <button
          type="button"
          className="btn btn-secondary"
          disabled={refreshing || loading}
          onClick={() => void handleRefresh()}
        >
          {refreshing || loading ? "Refreshing…" : "Refresh ranking"}
        </button>
      </div>

      <div
        className="card"
        style={{
          marginBottom: "1rem",
          display: "grid",
          gap: "0.75rem",
          fontSize: "0.8125rem",
        }}
      >
        <strong>Advanced (recomputes from real ranking)</strong>
        <label style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          Confidence floor ({confFloor.toFixed(2)})
          <input
            type="range"
            min={0.4}
            max={0.8}
            step={0.05}
            value={confFloor}
            onChange={(e) => setConfFloor(Number(e.target.value))}
            style={{ flex: 1, minWidth: "10rem" }}
            aria-label="Confidence floor"
          />
        </label>
        <label style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          Max per league
          <button
            type="button"
            className="btn btn-secondary"
            style={{ minHeight: 36, padding: "0 0.65rem" }}
            disabled={maxPerLeague <= 1}
            onClick={() => setMaxPerLeague((n) => Math.max(1, n - 1))}
          >
            −
          </button>
          <span style={{ fontVariantNumeric: "tabular-nums", minWidth: "1.5rem", textAlign: "center" }}>
            {maxPerLeague}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ minHeight: 36, padding: "0 0.65rem" }}
            disabled={maxPerLeague >= 10}
            onClick={() => setMaxPerLeague((n) => Math.min(10, n + 1))}
          >
            +
          </button>
        </label>
      </div>

      {ladder?.shortfallNotice && (
        <div className="alert" style={{ marginBottom: "1rem" }}>
          {ladder.shortfallNotice}
        </div>
      )}

      {!batch ? (
        <p className="page-sub">Select a saved batch to build the ladder.</p>
      ) : !ladder || ladder.n === 0 ? (
        <p className="page-sub">
          {loading
            ? "Ranking matches…"
            : "No matches met the confidence floor for this batch."}
        </p>
      ) : (
        <>
          {distStrip.length > 0 && (
            <div
              className="ladder-dist-strip"
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.35rem",
                marginBottom: "0.75rem",
              }}
              aria-label="League distribution"
            >
              {distStrip.map((d) => (
                <span
                  key={d.league}
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    padding: "0.25rem 0.5rem",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                  }}
                >
                  {d.label} {d.count}
                </span>
              ))}
            </div>
          )}

          <details
            className="card"
            style={{ marginBottom: "1rem", fontSize: "0.8125rem" }}
            open={whyOpen}
            onToggle={(e) => setWhyOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>Why these {ladder.n}?</summary>
            <p style={{ margin: "0.5rem 0 0" }}>
              Filtered to matches with confidence ≥ {ladder.selection.confFloor.toFixed(2)}, then
              spread across leagues (max {ladder.selection.maxPerLeagueInitial} per league, relaxed
              to {ladder.selection.maxPerLeagueUsed} only among floor-passers if needed).{" "}
              {ladder.selection.qualifiedCount} match
              {ladder.selection.qualifiedCount === 1 ? "" : "es"} qualified.
            </p>
            <p style={{ margin: "0.35rem 0 0", color: "var(--muted)" }}>
              Selected:{" "}
              {distStrip.map((d) => `${d.label} ${d.count}`).join(" · ") || "—"}
            </p>
            {ladder.selection.relaxReason ? (
              <p style={{ margin: "0.35rem 0 0", color: "var(--muted)" }}>
                {ladder.selection.relaxReason}
              </p>
            ) : null}
          </details>

          <div className="ladder-legend card" style={{ marginBottom: "1rem", fontSize: "0.8125rem" }}>
            <strong>Drop order (weakest first):</strong>{" "}
            {ladder.matches
              .map(
                (m) =>
                  `${m.letter}=${m.homeTeam} vs ${m.awayTeam} (${shortLeagueLabel(m.league)})`
              )
              .join(" · ")}
          </div>

          <div className="card ladder-table-wrap ladder-desktop">
            <table className="table ladder-table" style={{ width: "100%", fontSize: "0.8125rem" }}>
              <thead>
                <tr>
                  <th>Round</th>
                  <th>Bets</th>
                  <th>Legs</th>
                  <th>Risky Matches</th>
                  <th title="Product of P(2H>1H) — independent-leg approximation">
                    Combined Prob
                  </th>
                  <th>Risk Exposure</th>
                  {stakes ? <th>Suggested stake</th> : null}
                </tr>
              </thead>
              <tbody>
                {ladder.rounds.map((round, i) => (
                  <RoundTableRows
                    key={round.label}
                    round={round}
                    expanded={expandedRound === round.round}
                    onToggle={() =>
                      setExpandedRound((r) => (r === round.round ? null : round.round))
                    }
                    stake={stakes?.[i]}
                    batchId={batch.id}
                    legs={legsForRound(ladder, round)}
                  />
                ))}
              </tbody>
            </table>
            <p className="ladder-footnote">
              Diversifying legs across leagues makes this independence estimate more realistic, but
              correlation is never zero. Risky = P(2H&gt;1H) below 55%.
            </p>
          </div>

          <div className="ladder-mobile">
            {ladder.rounds.map((round, i) => (
              <RoundCard
                key={round.label}
                round={round}
                expanded={expandedRound === round.round}
                onToggle={() =>
                  setExpandedRound((r) => (r === round.round ? null : round.round))
                }
                stake={stakes?.[i]}
                batchId={batch.id}
                legs={legsForRound(ladder, round)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RoundTableRows({
  round,
  expanded,
  onToggle,
  stake,
  batchId,
  legs,
}: {
  round: LadderRound;
  expanded: boolean;
  onToggle: () => void;
  stake?: number;
  batchId: string;
  legs: ReturnType<typeof legsForRound>;
}) {
  return (
    <>
      <tr
        className={`ladder-round-row${expanded ? " is-expanded" : ""}`}
        onClick={onToggle}
        style={{ cursor: "pointer" }}
      >
        <td>
          <strong>{round.label}</strong> {expanded ? "▾" : "▸"}
        </td>
        <td>{round.bets}</td>
        <td>{round.legsSummary}</td>
        <td>{round.risky_display}</td>
        <td>{round.combined_display}</td>
        <td>
          <span className="ladder-risk-badge" style={riskBadgeStyle(round.risk_exposure)}>
            {riskLabel(round.risk_exposure)}
          </span>
        </td>
        {stake != null ? <td>{stake.toFixed(2)}</td> : null}
      </tr>
      {expanded ? (
        <tr className="ladder-legs-row">
          <td colSpan={stake != null ? 7 : 6}>
            <LegList batchId={batchId} legs={legs} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function RoundCard({
  round,
  expanded,
  onToggle,
  stake,
  batchId,
  legs,
}: {
  round: LadderRound;
  expanded: boolean;
  onToggle: () => void;
  stake?: number;
  batchId: string;
  legs: ReturnType<typeof legsForRound>;
}) {
  return (
    <div className={`card ladder-round-card${expanded ? " is-expanded" : ""}`}>
      <button type="button" className="ladder-round-card-head" onClick={onToggle}>
        <span>
          <strong>{round.label}</strong> · {round.bets} bets · {round.legsSummary}
        </span>
        <span className="ladder-risk-badge" style={riskBadgeStyle(round.risk_exposure)}>
          {riskLabel(round.risk_exposure)}
        </span>
      </button>
      <div className="ladder-round-card-meta">
        <span>Risky: {round.risky_display}</span>
        <span>Combined: {round.combined_display}</span>
        {stake != null ? <span>Stake: {stake.toFixed(2)}</span> : null}
      </div>
      {expanded ? <LegList batchId={batchId} legs={legs} /> : null}
    </div>
  );
}

function LegList({
  batchId,
  legs,
}: {
  batchId: string;
  legs: ReturnType<typeof legsForRound>;
}) {
  return (
    <ul className="ladder-leg-list">
      {legs.map((leg) => (
        <li key={leg.matchId}>
          <Link href={matchHref(batchId, leg.apiFixtureId)} className="ladder-leg-link">
            <span className="ladder-leg-letter">{leg.letter}</span>
            <span>
              {leg.homeTeam} vs {leg.awayTeam}{" "}
              <span
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "var(--muted)",
                  marginLeft: "0.25rem",
                }}
              >
                {shortLeagueLabel(leg.league)}
              </span>
            </span>
            <span className="ladder-leg-meta">
              {leg.kickoff} · P(2H&gt;1H) {leg.p2h_display} · conf {leg.confidence_display}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
