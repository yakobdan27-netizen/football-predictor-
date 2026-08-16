"use client";

import { useMemo, useState, type CSSProperties } from "react";
import {
  BlendedAnalysisNotice,
  pickBlendFromEstimates,
} from "@/components/analysis/blended-analysis-notice";
import { pickBatchBestHsh, type HshConfidence } from "@/lib/prediction-log/hsh-model";
import { leagueShortLabel, matchLeague } from "@/lib/prediction-log/match-league";
import { usePredictionLogData } from "@/components/prediction-log/use-prediction-log-data";
import { useHshPredictions } from "@/components/prediction-log/use-hsh-predictions";
import type { UpcomingFixtureRow } from "@/lib/football-api/fetch-upcoming-league";
import { OpenInDmButton } from "./open-in-dm-button";
import { UpcomingFixturesHeader } from "./upcoming-fixtures-header";
import { useUpcomingPredictions } from "./upcoming-predictions-context";

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

function formatKickoff(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function UpcomingHshPanel() {
  const { batch, fixtures, loading: fixturesLoading } = useUpcomingPredictions();
  const { ready, error, batches } = usePredictionLogData();
  const [leagueFilter, setLeagueFilter] = useState<string>("all");

  const fixtureByApiId = useMemo(() => {
    const m = new Map<number, UpcomingFixtureRow>();
    for (const f of fixtures) m.set(f.apiFixtureId, f);
    return m;
  }, [fixtures]);

  const { predictions, error: predError, estimatesById } = useHshPredictions(
    batch,
    batches
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

  const filtered = useMemo(() => {
    if (!batch || leagueFilter === "all") return predictions;
    const allow = new Set(
      batch.matches
        .filter((m) => matchLeague(m, batch.league) === leagueFilter)
        .map((m) => m.id)
    );
    return predictions.filter((p) => allow.has(p.matchId));
  }, [predictions, batch, leagueFilter]);

  const batchBest = useMemo(() => pickBatchBestHsh(filtered), [filtered]);

  if (!ready || fixturesLoading) {
    return (
      <div>
        <UpcomingFixturesHeader />
        <p className="page-sub">Loading predictions…</p>
      </div>
    );
  }

  return (
    <div>
      <UpcomingFixturesHeader />

      {(error || predError) && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error ?? predError}
        </div>
      )}

      <BlendedAnalysisNotice blend={blendNotice} pageLabel="Half Goals" />

      <p className="page-sub" style={{ marginBottom: "1rem" }}>
        Attack × defence λs with tempo nudges, then Dixon-Coles Stage B — same engine as Goals &
        Survival, applied to Match Centre upcoming fixtures.
      </p>

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
          League
          <select
            className="select"
            style={{ display: "block", marginTop: "0.25rem", minWidth: "12rem" }}
            value={leagueFilter}
            onChange={(e) => setLeagueFilter(e.target.value)}
          >
            <option value="all">All leagues</option>
            {leagues.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>

      {batchBest && (
        <div
          className="alert"
          style={{
            marginBottom: "1rem",
            background: "rgba(34, 197, 94, 0.12)",
            border: "1px solid rgba(34, 197, 94, 0.35)",
          }}
        >
          Best in pool (advisory): <strong>{batchBest.homeTeam} vs {batchBest.awayTeam}</strong>
          {" — "}
          {batchBest.recommended} ({pct(batchBest.topProbability)}, {batchBest.confidence})
        </div>
      )}

      {!batch || filtered.length === 0 ? (
        <p className="page-sub">No upcoming fixtures to predict.</p>
      ) : (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <table className="table mobile-stack-table" style={{ width: "100%", fontSize: "0.8125rem" }}>
            <thead>
              <tr>
                <th>Kickoff</th>
                <th>Match</th>
                <th>League</th>
                <th>P(1H)</th>
                <th>P(2H)</th>
                <th>P(Tie)</th>
                <th>Rec</th>
                <th>Conf</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const match = batch.matches.find((m) => m.id === p.matchId);
                const league = match ? matchLeague(match, batch.league) : "";
                const fx =
                  match?.apiFixtureId != null
                    ? fixtureByApiId.get(match.apiFixtureId)
                    : undefined;
                return (
                  <tr key={p.matchId}>
                    <td data-label="Kickoff">
                      {fx ? formatKickoff(fx.kickoffIso) : match?.matchDate ?? "—"}
                    </td>
                    <td data-label="Match">
                      <strong>
                        {p.homeTeam} vs {p.awayTeam}
                      </strong>
                    </td>
                    <td data-label="League">{leagueShortLabel(league)}</td>
                    <td data-label="P(1H)">{pct(p.p1h)}</td>
                    <td data-label="P(2H)">{pct(p.p2h)}</td>
                    <td data-label="P(Tie)">{pct(p.pTie)}</td>
                    <td data-label="Rec">
                      <strong>{p.recommended}</strong>
                    </td>
                    <td data-label="Conf">
                      <span className="badge" style={confidenceStyle(p.confidence)}>
                        {p.confidence}
                      </span>
                    </td>
                    <td data-label="Actions">
                      {fx ? <OpenInDmButton row={fx} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
