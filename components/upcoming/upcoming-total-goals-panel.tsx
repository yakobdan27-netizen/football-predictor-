"use client";

import { useMemo, useState, type CSSProperties } from "react";
import {
  BlendedAnalysisNotice,
  pickBlendFromEstimates,
} from "@/components/analysis/blended-analysis-notice";
import { useHalfParamsCache } from "@/components/prediction-log/use-half-params-cache";
import { usePredictionLogData } from "@/components/prediction-log/use-prediction-log-data";
import {
  useTotalGoalsPredictions,
  type TotalGoalsRow,
} from "@/components/prediction-log/use-total-goals-predictions";
import { matchLeague } from "@/lib/prediction-log/match-league";
import type { TotalGoalsLine } from "@/lib/prediction-log/total-goals-markets";
import type { UpcomingFixtureRow } from "@/lib/football-api/fetch-upcoming-league";
import { OpenInDmButton } from "./open-in-dm-button";
import { UpcomingFixturesHeader } from "./upcoming-fixtures-header";
import { useUpcomingPredictions } from "./upcoming-predictions-context";

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

export function UpcomingTotalGoalsPanel() {
  const { batch, fixtures, loading: fixturesLoading } = useUpcomingPredictions();
  const { ready, error, batches } = usePredictionLogData();
  const { store: halfStore, loading: halfLoading, error: halfError } =
    useHalfParamsCache();
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("expected");

  const fixtureByApiId = useMemo(() => {
    const m = new Map<number, UpcomingFixtureRow>();
    for (const f of fixtures) m.set(f.apiFixtureId, f);
    return m;
  }, [fixtures]);

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
    sorted.sort((a, b) => compareRows(a, b, sortKey));
    return sorted;
  }, [rows, leagueFilter, sortKey, batch]);

  if (!ready || fixturesLoading || halfLoading) {
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

      {(error || halfError) && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error ?? halfError}
        </div>
      )}

      <BlendedAnalysisNotice blend={blendNotice} pageLabel="Total Goals" />

      <p className="page-sub" style={{ marginBottom: "1rem" }}>
        Full-match goals from the canonical FT score matrix — same as Goals & Survival Total Goals
        tab, on Match Centre upcoming fixtures.
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

      {!batch || filteredSorted.length === 0 ? (
        <p className="page-sub">No upcoming fixtures to predict.</p>
      ) : (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <table className="table mobile-stack-table" style={{ width: "100%", fontSize: "0.8125rem" }}>
            <thead>
              <tr>
                <th>Kickoff</th>
                <th>Match</th>
                <th>E[T]</th>
                <th>O1.5</th>
                <th>O2.5</th>
                <th>O3.5</th>
                <th>Conf</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map((row) => {
                const match = batch.matches.find((m) => m.id === row.matchId);
                const fx =
                  match?.apiFixtureId != null
                    ? fixtureByApiId.get(match.apiFixtureId)
                    : undefined;
                return (
                  <tr key={row.matchId}>
                    <td data-label="Kickoff">
                      {fx ? formatKickoff(fx.kickoffIso) : row.kickoff}
                    </td>
                    <td data-label="Match">
                      <strong>
                        {row.homeTeam} vs {row.awayTeam}
                      </strong>
                    </td>
                    <td data-label="E[T]">{row.totalGoals.expectedTotal.toFixed(2)}</td>
                    <td data-label="O1.5">{pct(row.totalGoals.lines[1.5]?.over ?? 0)}</td>
                    <td data-label="O2.5">{pct(row.totalGoals.lines[2.5]?.over ?? 0)}</td>
                    <td data-label="O3.5">{pct(row.totalGoals.lines[3.5]?.over ?? 0)}</td>
                    <td data-label="Conf">
                      <span className="badge" style={confidenceStyle(row.confidence)}>
                        {row.confidence}
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

function compareRows(a: TotalGoalsRow, b: TotalGoalsRow, sortKey: SortKey): number {
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
      (b.totalGoals.lines[line]?.over ?? 0) - (a.totalGoals.lines[line]?.over ?? 0)
    );
  }
  if (sortKey.startsWith("under_")) {
    const line = Number(sortKey.slice(6)) as TotalGoalsLine;
    return (
      (b.totalGoals.lines[line]?.under ?? 0) - (a.totalGoals.lines[line]?.under ?? 0)
    );
  }
  return 0;
}
