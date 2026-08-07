"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  buildLadder,
  LADDER_CONFIG,
  legsForRound,
  shortLeagueLabel,
  suggestStakeSplit,
  type ConfTier,
  type LadderMatch,
  type LadderRound,
  type RiskExposure,
} from "@/lib/prediction-log/ladder";
import { blendBadgeLabel, blendBadgeTitle } from "@/lib/prediction-log/prediction-weights";
import { reloadBatchesFromServer } from "@/lib/prediction-log/storage";
import { usePredictionLogData } from "./use-prediction-log-data";
import { useTwoHHeavyRanking } from "./use-two-h-heavy-ranking";

const HONESTY_BANNER =
  "This ladder lowers the chance of losing everything — it does NOT guarantee a win. Spreading across rounds reduces wipeout risk but also reduces total payout, because safer rounds (fewer legs) pay less. Losing one match knocks out only the rounds that include it; rounds that already dropped it can still land. All probabilities are model estimates, not certainties.";

const TIER_TOOLTIP =
  "A = strong confidence; B = medium; C = weak. Tier is only a quality label — the top 10 matches are always shown; weaker legs simply drop out first in the ladder.";

const INDEPENDENCE_NOTE =
  "Diversifying legs across leagues makes this independence estimate more realistic, but correlation is never zero.";

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

function tierChipStyle(tier: ConfTier): CSSProperties {
  switch (tier) {
    case "A":
      return { background: "rgba(34, 197, 94, 0.16)", color: "#166534" };
    case "B":
      return { background: "rgba(245, 158, 11, 0.18)", color: "#b45309" };
    default:
      return { background: "rgba(185, 28, 28, 0.12)", color: "#b91c1c" };
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
  const [maxPerLeague, setMaxPerLeague] = useState<number>(LADDER_CONFIG.MAX_PER_LEAGUE);
  const [whyOpen, setWhyOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!batchId && sortedBatches[0]) setBatchId(sortedBatches[0].id);
  }, [sortedBatches, batchId]);

  const batch = sortedBatches.find((b) => b.id === batchId) ?? null;
  const { ranked, loading } = useTwoHHeavyRanking(batch, batches, { refreshToken });

  const ladder = useMemo(() => {
    if (!batch) return null;
    return buildLadder({ ranked, batch, maxPerLeague });
  }, [ranked, batch, maxPerLeague]);

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

  const tierCounts = ladder?.selection.tierCounts;

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
          Round-reduction parlays from the top {LADDER_CONFIG.LADDER_SIZE} ranked matches,
          spread across leagues. Confidence labels quality — it never filters matches out.
        </p>
      </div>

      <div className="alert ladder-honesty-banner" role="status">
        <strong>Honesty:</strong> {HONESTY_BANNER}
      </div>

      <p className="ladder-payout-note">
        <strong>Payout vs. Safety:</strong> R1 (most legs) = highest potential payout, lowest hit rate.
        Later rounds (fewer legs) = lower payout, higher hit rate. {INDEPENDENCE_NOTE}
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

      <div className="card" style={{ marginBottom: "1rem", fontSize: "0.8125rem" }}>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: "0.8125rem" }}
          onClick={() => setAdvancedOpen((o) => !o)}
        >
          {advancedOpen ? "Hide advanced" : "Advanced"} · max per league {maxPerLeague}
        </button>
        {advancedOpen ? (
          <label
            style={{
              display: "block",
              marginTop: "0.75rem",
              fontWeight: 600,
            }}
          >
            Max per league
            <input
              className="input"
              type="number"
              min={1}
              max={LADDER_CONFIG.LADDER_SIZE}
              step={1}
              value={maxPerLeague}
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                if (!Number.isFinite(v)) return;
                setMaxPerLeague(
                  Math.min(LADDER_CONFIG.LADDER_SIZE, Math.max(1, v))
                );
              }}
              style={{ display: "block", marginTop: "0.25rem", width: "8rem" }}
            />
            <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: "0.75rem" }}>
              Soft cap — relaxes automatically so the ladder still fills to{" "}
              {LADDER_CONFIG.LADDER_SIZE} when enough matches exist. Set to{" "}
              {LADDER_CONFIG.LADDER_SIZE} for plain global top-{LADDER_CONFIG.LADDER_SIZE}.
            </span>
          </label>
        ) : null}
      </div>

      {ladder?.shortfallNotice && (
        <div className="alert" style={{ marginBottom: "1rem" }}>
          {ladder.shortfallNotice}
        </div>
      )}

      {ladder?.weakLadderNotice && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }} role="status">
          {ladder.weakLadderNotice}
        </div>
      )}

      {!batch ? (
        <p className="page-sub">Select a saved batch to build the ladder.</p>
      ) : !ladder || ladder.n === 0 ? (
        <p className="page-sub">
          {loading
            ? "Ranking matches…"
            : "Enter matches in a batch to build the ladder. Need at least 10 for a full ladder."}
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
                marginBottom: "0.5rem",
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

          {tierCounts && (
            <p
              className="ladder-tier-summary"
              style={{
                fontSize: "0.8125rem",
                fontWeight: 600,
                marginBottom: "0.5rem",
              }}
            >
              Tier A: {tierCounts.A} · Tier B: {tierCounts.B} · Tier C: {tierCounts.C}
            </p>
          )}

          {ladder.qualitySummary && (
            <p className="page-sub" style={{ marginBottom: "0.75rem" }}>
              {ladder.qualitySummary}
            </p>
          )}

          <div className="card" style={{ marginBottom: "1rem", fontSize: "0.8125rem" }}>
            <button
              type="button"
              onClick={() => setWhyOpen((o) => !o)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                fontWeight: 700,
                cursor: "pointer",
                color: "inherit",
                fontSize: "inherit",
              }}
            >
              {whyOpen ? "▾" : "▸"} Why these {ladder.n}?
            </button>
            {whyOpen && ladder.whyThese ? (
              <p style={{ marginTop: "0.5rem", marginBottom: 0 }}>{ladder.whyThese}</p>
            ) : null}
          </div>

          <div className="ladder-legend card" style={{ marginBottom: "1rem", fontSize: "0.8125rem" }}>
            <strong>Drop order (weakest first):</strong>{" "}
            {ladder.matches
              .map(
                (m) =>
                  `${m.letter}=${m.homeTeam} vs ${m.awayTeam} ${m.p2h_display} [${m.tier}] (${shortLeagueLabel(m.league)})`
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
                  <th title="Each leg’s model P(2H&gt;1H)">Match %</th>
                  <th>Risky</th>
                  <th title="Product of individual match % — independent-leg approximation">
                    Combined
                  </th>
                  <th>Risk</th>
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
              Top {LADDER_CONFIG.LADDER_SIZE} by p×confidence, then spread across leagues. Risky =
              P(2H&gt;1H) below 55%. {INDEPENDENCE_NOTE}
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

function TierChip({ tier }: { tier: ConfTier }) {
  return (
    <span
      title={TIER_TOOLTIP}
      style={{
        ...tierChipStyle(tier),
        fontSize: "0.65rem",
        fontWeight: 800,
        padding: "0.1rem 0.35rem",
        borderRadius: 3,
        marginLeft: "0.35rem",
        letterSpacing: "0.02em",
      }}
    >
      {tier}
    </span>
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
  legs: LadderMatch[];
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
        <td style={{ fontVariantNumeric: "tabular-nums", maxWidth: "22rem" }}>
          {round.leg_percents_display}
        </td>
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
          <td colSpan={stake != null ? 8 : 7}>
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
  legs: LadderMatch[];
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
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          Match %: {round.leg_percents_display}
        </span>
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
  legs: LadderMatch[];
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
              <TierChip tier={leg.tier} />
            </span>
            <span className="ladder-leg-meta">
              <strong style={{ fontVariantNumeric: "tabular-nums" }}>{leg.p2h_display}</strong>
              {" · "}
              conf {leg.confidence_display}
              {" · "}
              <span title={blendBadgeTitle("api_only")}>{blendBadgeLabel("api_only")}</span>
              {" · "}
              {leg.kickoff}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
