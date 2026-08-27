"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  buildLadder,
  LADDER_CONFIG,
  labelTier,
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
import { useWeekendPicksBatch } from "./use-weekend-picks-batch";
import {
  BlendedAnalysisNotice,
  pickBlendFromEstimates,
} from "@/components/analysis/blended-analysis-notice";

const HONESTY_BANNER =
  "This ladder lowers the chance of losing everything — it does NOT guarantee a win. Spreading across rounds reduces wipeout risk but also reduces total payout, because safer rounds (fewer legs) pay less. Losing one match knocks out only the rounds that include it; rounds that already dropped it can still land. All probabilities are model estimates, not certainties.";

const TIER_TOOLTIP =
  "A = strong confidence; B = medium; C = weak. Tier is only a quality label — the top 10 matches are always shown; weaker legs simply drop out first in the ladder.";

const INDEPENDENCE_NOTE =
  "Diversifying legs across leagues makes this independence estimate more realistic, but correlation is never zero.";

type FixtureSource = "weekend" | "saved";

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
  const weekend = useWeekendPicksBatch();
  const sortedBatches = useMemo(
    () =>
      [...batches].sort(
        (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
      ),
    [batches]
  );

  const [fixtureSource, setFixtureSource] = useState<FixtureSource>("weekend");
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

  const savedBatch = sortedBatches.find((b) => b.id === batchId) ?? null;
  const batch = fixtureSource === "weekend" ? weekend.batch : savedBatch;
  const { ranked, loading, estimatesById } = useTwoHHeavyRanking(batch, batches, {
    refreshToken,
  });
  const blendNotice = useMemo(
    () => pickBlendFromEstimates(estimatesById),
    [estimatesById]
  );

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

  const ladderMatchIds = useMemo(() => {
    if (!ladder) return new Set<string>();
    return new Set(ladder.matches.map((m) => m.matchId));
  }, [ladder]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      if (fixtureSource === "weekend") {
        await weekend.refresh();
      } else {
        await reloadBatchesFromServer();
        await refresh();
      }
      setRefreshToken((t) => t + 1);
    } finally {
      setRefreshing(false);
    }
  }

  if (!ready || (fixtureSource === "weekend" && weekend.loading)) {
    return <p className="page-sub">Loading…</p>;
  }

  return (
    <div className="ladder-page">
      {(error || (fixtureSource === "weekend" && weekend.error)) && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error ?? weekend.error}
        </div>
      )}

      <BlendedAnalysisNotice blend={blendNotice} pageLabel="Survival Ladder" />

      <div style={{ marginBottom: "1rem" }}>
        <h1 className="page-title">Survival Ladder (2H &gt; 1H)</h1>
        <p className="page-sub">
          Ranks all Weekend Picks fixtures (next 7 days, five leagues) by P(2H&gt;1H),
          then builds round-reduction parlays from the top {LADDER_CONFIG.LADDER_SIZE}{" "}
          matches, spread across leagues. Confidence labels quality — it never filters
          matches out.
        </p>
        {fixtureSource === "weekend" && weekend.fixturePoolCount > 0 && (
          <p className="page-sub" style={{ marginTop: "0.25rem" }}>
            {weekend.fixturePoolCount} matches in pool
            {weekend.generatedAt
              ? ` · updated ${new Date(weekend.generatedAt).toLocaleTimeString()}`
              : ""}
          </p>
        )}
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
          Fixture source
          <select
            className="select"
            style={{ display: "block", marginTop: "0.25rem", minWidth: "14rem" }}
            value={fixtureSource}
            onChange={(e) => {
              setFixtureSource(e.target.value as FixtureSource);
              setExpandedRound(1);
            }}
          >
            <option value="weekend">Weekend Picks (API)</option>
            <option value="saved">Saved batch</option>
          </select>
        </label>

        {fixtureSource === "saved" ? (
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
        ) : null}

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
          disabled={refreshing || loading || (fixtureSource === "weekend" && weekend.refreshing)}
          onClick={() => void handleRefresh()}
        >
          {refreshing || loading || (fixtureSource === "weekend" && weekend.refreshing)
            ? "Refreshing…"
            : fixtureSource === "weekend"
              ? "Refresh from API"
              : "Refresh ranking"}
        </button>
      </div>

      {fixtureSource === "weekend" &&
        weekend.warnings.map((w) => (
          <p
            key={w}
            style={{
              padding: "0.65rem 0.85rem",
              marginBottom: "0.75rem",
              background: "rgba(245, 158, 11, 0.12)",
              borderRadius: 8,
              fontSize: "0.8125rem",
            }}
          >
            {w}
          </p>
        ))}

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
        <p className="page-sub">
          {fixtureSource === "weekend"
            ? "No Weekend Picks fixtures in the next 7 days."
            : "Select a saved batch to build the ladder."}
        </p>
      ) : ranked.length === 0 ? (
        <p className="page-sub">
          {loading ? "Ranking matches…" : "No rankable matches in this pool."}
        </p>
      ) : (
        <>
          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>
              Full pool ranking ({ranked.length} matches)
            </h2>
            <table
              className="table mobile-stack-table"
              style={{ width: "100%", fontSize: "0.8125rem" }}
            >
              <thead>
                <tr>
                  <th>#</th>
                  <th>Match</th>
                  <th>League</th>
                  <th>P(2H&gt;1H)</th>
                  <th>Tier</th>
                  <th>Ladder</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => {
                  const inLadder = ladderMatchIds.has(r.matchId);
                  const p =
                    Number.isFinite(r.p_2h_gt_1h) && r.p_2h_gt_1h != null
                      ? `${(r.p_2h_gt_1h * 100).toFixed(1)}%`
                      : "—";
                  const tier = labelTier(r.confidence);
                  return (
                    <tr
                      key={r.matchId}
                      style={
                        inLadder
                          ? { background: "rgba(34, 197, 94, 0.08)" }
                          : undefined
                      }
                    >
                      <td>{i + 1}</td>
                      <td>
                        <strong>
                          {r.homeTeam} vs {r.awayTeam}
                        </strong>
                      </td>
                      <td>{shortLeagueLabel(r.league)}</td>
                      <td>{p}</td>
                      <td>
                        <TierChip tier={tier} />
                      </td>
                      <td>
                        {inLadder ? (
                          <span
                            style={{
                              fontSize: "0.7rem",
                              fontWeight: 700,
                              color: "#15803d",
                            }}
                          >
                            Top {LADDER_CONFIG.LADDER_SIZE}
                          </span>
                        ) : (
                          <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="page-sub" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
              Rank score = P(2H&gt;1H) × ladder confidence. Highlighted rows feed the
              top-{LADDER_CONFIG.LADDER_SIZE} survival ladder below.
            </p>
          </div>

          {!ladder || ladder.n === 0 ? (
            <p className="page-sub">
              Need at least one rankable match for a ladder. A full ladder needs{" "}
              {LADDER_CONFIG.LADDER_SIZE} legs when enough matches exist.
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
              Model % is canonical P(2H&gt;1H) (same as Half-Time Ranking). Ranked by
              p×ladder-confidence, then spread across leagues. Risky = P(2H&gt;1H) below 55%.{" "}
              {INDEPENDENCE_NOTE}
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
              <span title="Ladder rank confidence (sort key) — not the model probability">
                ladder conf {leg.confidence_display}
              </span>
              {" · "}
              <span
                title={blendBadgeTitle(leg.sourceBreakdown ?? "api_only")}
              >
                {blendBadgeLabel(leg.sourceBreakdown ?? "api_only")}
              </span>
              {" · "}
              {leg.kickoff}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
