"use client";

import { useMemo, useState, type CSSProperties } from "react";
import {
  BlendedAnalysisNotice,
  pickBlendFromEstimates,
} from "@/components/analysis/blended-analysis-notice";
import { usePredictionLogData } from "@/components/prediction-log/use-prediction-log-data";
import { useTwoHHeavyRanking } from "@/components/prediction-log/use-two-h-heavy-ranking";
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
import type { UpcomingFixtureRow } from "@/lib/football-api/fetch-upcoming-league";
import { OpenInDmButton } from "./open-in-dm-button";
import { UpcomingFixturesHeader } from "./upcoming-fixtures-header";
import { useUpcomingPredictions } from "./upcoming-predictions-context";

const HONESTY_BANNER =
  "This ladder lowers the chance of losing everything — it does NOT guarantee a win. All probabilities are model estimates, not certainties.";

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

export function UpcomingLadderPanel() {
  const { batch, fixtures, loading: fixturesLoading } = useUpcomingPredictions();
  const { ready, error, batches } = usePredictionLogData();
  const [expandedRound, setExpandedRound] = useState<number | null>(1);
  const [bankrollInput, setBankrollInput] = useState("");
  const [maxPerLeague, setMaxPerLeague] = useState<number>(LADDER_CONFIG.MAX_PER_LEAGUE);
  const [whyOpen, setWhyOpen] = useState(false);

  const fixtureByApiId = useMemo(() => {
    const m = new Map<number, UpcomingFixtureRow>();
    for (const f of fixtures) m.set(f.apiFixtureId, f);
    return m;
  }, [fixtures]);

  const { ranked, estimatesById } = useTwoHHeavyRanking(batch, batches);
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

  if (!ready || fixturesLoading) {
    return (
      <div>
        <UpcomingFixturesHeader />
        <p className="page-sub">Loading ladder…</p>
      </div>
    );
  }

  return (
    <div className="ladder-page">
      <UpcomingFixturesHeader />

      {error && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <BlendedAnalysisNotice blend={blendNotice} pageLabel="Survival Ladder" />

      <p className="page-sub" style={{ marginBottom: "1rem" }}>
        Top {LADDER_CONFIG.LADDER_SIZE} upcoming fixtures ranked by P(2H&gt;1H) × ladder confidence
        — same survival ladder logic as Goals & Survival.
      </p>

      <div className="alert ladder-honesty-banner" role="status">
        <strong>Honesty:</strong> {HONESTY_BANNER}
      </div>

      <p className="ladder-payout-note" style={{ fontSize: "0.8125rem", marginBottom: "1rem" }}>
        {INDEPENDENCE_NOTE}
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
          Max per league
          <input
            type="number"
            min={1}
            max={10}
            className="input"
            style={{ display: "block", marginTop: "0.25rem", width: "5rem" }}
            value={maxPerLeague}
            onChange={(e) =>
              setMaxPerLeague(Math.max(1, Math.min(10, Number(e.target.value) || 3)))
            }
          />
        </label>
        <label style={{ fontSize: "0.8125rem", fontWeight: 600 }}>
          Bankroll (optional)
          <input
            type="text"
            inputMode="decimal"
            className="input"
            placeholder="e.g. 100"
            style={{ display: "block", marginTop: "0.25rem", width: "8rem" }}
            value={bankrollInput}
            onChange={(e) => setBankrollInput(e.target.value)}
          />
        </label>
        <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: 0 }}>
          Pool: {fixtures.length} fixtures · ranked {ranked.length}
        </p>
      </div>

      {ladder?.weakLadderNotice && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }} role="status">
          {ladder.weakLadderNotice}
        </div>
      )}

      {!batch || !ladder || ladder.n === 0 ? (
        <p className="page-sub">
          Need upcoming fixtures in the pool to build a ladder (ideally ≥10 for a full ladder).
        </p>
      ) : (
        <>
          {distStrip.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.35rem",
                marginBottom: "0.5rem",
              }}
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
              }}
            >
              {whyOpen ? "▾" : "▸"} Why these {ladder.n}?
            </button>
            {whyOpen && ladder.whyThese ? (
              <p style={{ marginTop: "0.5rem", marginBottom: 0 }}>{ladder.whyThese}</p>
            ) : null}
          </div>

          <div className="card ladder-table-wrap">
            <table className="table ladder-table" style={{ width: "100%", fontSize: "0.8125rem" }}>
              <thead>
                <tr>
                  <th>Round</th>
                  <th>Bets</th>
                  <th>Legs</th>
                  <th>Match %</th>
                  <th>Combined</th>
                  <th>Risk</th>
                  {stakes ? <th>Stake</th> : null}
                </tr>
              </thead>
              <tbody>
                {ladder.rounds.map((round, i) => (
                  <RoundRows
                    key={round.label}
                    round={round}
                    expanded={expandedRound === round.round}
                    onToggle={() =>
                      setExpandedRound((r) => (r === round.round ? null : round.round))
                    }
                    stake={stakes?.[i]}
                    legs={legsForRound(ladder, round)}
                    fixtureByApiId={fixtureByApiId}
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

function RoundRows({
  round,
  expanded,
  onToggle,
  stake,
  legs,
  fixtureByApiId,
}: {
  round: LadderRound;
  expanded: boolean;
  onToggle: () => void;
  stake?: number;
  legs: LadderMatch[];
  fixtureByApiId: Map<number, UpcomingFixtureRow>;
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer" }}>
        <td>
          <strong>{round.label}</strong> {expanded ? "▾" : "▸"}
        </td>
        <td>{round.bets}</td>
        <td>{round.legsSummary}</td>
        <td>{round.leg_percents_display}</td>
        <td>{round.combined_display}</td>
        <td>
          <span style={riskBadgeStyle(round.risk_exposure)}>{riskLabel(round.risk_exposure)}</span>
        </td>
        {stake != null ? <td>{stake.toFixed(2)}</td> : null}
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={stake != null ? 7 : 6}>
            <ul style={{ listStyle: "none", padding: 0, margin: "0.5rem 0 0" }}>
              {legs.map((leg) => {
                const fx =
                  leg.apiFixtureId != null
                    ? fixtureByApiId.get(leg.apiFixtureId)
                    : undefined;
                return (
                  <li
                    key={leg.matchId}
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "0.5rem",
                      alignItems: "center",
                      padding: "0.35rem 0",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <span style={{ fontWeight: 800, width: "1.25rem" }}>{leg.letter}</span>
                    <span>
                      {leg.homeTeam} vs {leg.awayTeam}{" "}
                      <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                        {shortLeagueLabel(leg.league)}
                      </span>
                      <span
                        style={{
                          ...tierChipStyle(leg.tier),
                          fontSize: "0.65rem",
                          fontWeight: 800,
                          padding: "0.1rem 0.35rem",
                          borderRadius: 3,
                          marginLeft: "0.35rem",
                        }}
                      >
                        {leg.tier}
                      </span>
                    </span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {leg.p2h_display} · {leg.confidence_display}
                    </span>
                    <span
                      title={blendBadgeTitle(leg.sourceBreakdown ?? "api_only")}
                      style={{ fontSize: "0.7rem", color: "var(--muted)" }}
                    >
                      {blendBadgeLabel(leg.sourceBreakdown ?? "api_only")}
                    </span>
                    {fx ? <OpenInDmButton row={fx} label="DM" /> : null}
                  </li>
                );
              })}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}
