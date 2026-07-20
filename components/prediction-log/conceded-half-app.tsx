"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { LEAGUE_OPTIONS } from "@/lib/prediction-log/markets-config";
import {
  recommendationLabel,
  type ConcededConfidence,
  type ConcededHalfPrediction,
  type ConcededHalfTeamStats,
} from "@/lib/prediction-log/conceded-half-model";
import { usePredictionLogData } from "./use-prediction-log-data";
import { useConcededHalfPredictions, useConcededHalfStats } from "./use-conceded-half-stats";

const KNOWN_SEASONS = ["2025/26", "2024/25", "2023/24", "2022/23", "2021/22"];

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

function pctProb(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function confidenceStyle(c: ConcededConfidence): CSSProperties {
  switch (c) {
    case "high":
      return { background: "rgba(34, 197, 94, 0.2)", color: "#15803d" };
    case "medium":
      return { background: "rgba(245, 158, 11, 0.2)", color: "#b45309" };
    default:
      return { background: "var(--surface2)", color: "var(--muted)" };
  }
}

function profileStyle(profile: string): CSSProperties {
  if (profile === "Slow Starter") return { color: "#b45309" };
  if (profile === "Late Collapser") return { color: "#b91c1c" };
  return { color: "var(--muted)" };
}

export function ConcededHalfApp() {
  const searchParams = useSearchParams();
  const { ready, error, batches } = usePredictionLogData();

  const [league, setLeague] = useState<string>("");
  const [season, setSeason] = useState<string>("all");
  const [batchId, setBatchId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const qLeague = searchParams.get("league");
    const qSeason = searchParams.get("season");
    if (qLeague) {
      const mapped =
        qLeague === "EPL" || qLeague === "PL" ? "Premier League" : qLeague;
      setLeague(mapped);
    }
    if (qSeason) {
      const normalized =
        qSeason === "all" ? "all" : qSeason.includes("/") ? qSeason : qSeason.replace("-", "/");
      setSeason(normalized);
    }
  }, [searchParams]);

  const { logRows, teamStats, leagues, seasons } = useConcededHalfStats(batches, {
    league: league || null,
    season: season === "all" ? "all" : season,
  });

  const leagueChoices = useMemo(() => {
    const set = new Set([...LEAGUE_OPTIONS, ...leagues]);
    return [...set].sort();
  }, [leagues]);

  const seasonChoices = useMemo(() => {
    const set = new Set([...KNOWN_SEASONS, ...seasons]);
    return [...set].sort().reverse();
  }, [seasons]);

  const sortedBatches = useMemo(
    () =>
      [...batches].sort(
        (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
      ),
    [batches]
  );

  useEffect(() => {
    if (!batchId && sortedBatches[0]) setBatchId(sortedBatches[0].id);
  }, [sortedBatches, batchId]);

  const batch = sortedBatches.find((b) => b.id === batchId) ?? null;
  const predictions = useConcededHalfPredictions(batch, batches, logRows);

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
        <h1 className="page-title">Conceded Half Analysis</h1>
        <p className="page-sub">
          Goals conceded by half — defensive profiles from batch HT history. Advisory only; never
          blocks a pick.
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
        <label style={{ fontSize: "0.8125rem", display: "flex", gap: "0.4rem", alignItems: "center" }}>
          League
          <select
            value={league}
            onChange={(e) => setLeague(e.target.value)}
            style={{ minWidth: "10rem" }}
          >
            <option value="">All leagues</option>
            {leagueChoices.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: "0.8125rem", display: "flex", gap: "0.4rem", alignItems: "center" }}>
          Season
          <select
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            style={{ minWidth: "8rem" }}
          >
            <option value="all">All seasons</option>
            {seasonChoices.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          {teamStats.length} teams · {logRows.length / 2} matches with HT
        </span>
        <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          Seed prior blended with live HT by match count (fades as scraper fills).
        </span>
      </div>

      {teamStats.length === 0 ? (
        <p className="page-sub">
          No half-conceded samples yet. Enter HT scores on settled batches (or scrape livescore) to
          populate this table.
        </p>
      ) : (
        <div className="card" style={{ overflowX: "auto", marginBottom: "1.5rem" }}>
          <table className="data-table" style={{ minWidth: "56rem" }}>
            <thead>
              <tr>
                <th>Team</th>
                <th>Avg Conc.</th>
                <th>1H Conc.</th>
                <th>2H Conc.</th>
                <th>1H&gt;2H %</th>
                <th>1H=2H %</th>
                <th>2H&gt;1H %</th>
                <th>CS 1H %</th>
                <th>CS 2H %</th>
                <th>Profile</th>
                <th>Conf.</th>
              </tr>
            </thead>
            <tbody>
              {teamStats.map((row) => (
                <TeamRow key={`${row.team}|${row.league}|${row.season}`} row={row} />
              ))}
            </tbody>
          </table>
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
            Low confidence = informational only — you may still proceed. Never a hard stop.
          </p>
        </div>
      )}

      <div style={{ marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>
          Match advisory (0.5 scored + 0.5 conceded)
        </h2>
        <p className="page-sub" style={{ marginTop: "0.25rem" }}>
          Module-local Poisson blend for the selected batch. Does not change Half Goals Stage
          A on the merged half page.
          A.
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
        <label style={{ fontSize: "0.8125rem", display: "flex", gap: "0.4rem", alignItems: "center" }}>
          Batch
          <select
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            style={{ minWidth: "14rem" }}
          >
            {sortedBatches.length === 0 && <option value="">No batches</option>}
            {sortedBatches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.batchName || b.date} · {b.league} ({b.matches.length})
              </option>
            ))}
          </select>
        </label>
      </div>

      {predictions.length === 0 ? (
        <p className="page-sub">Select a batch with matches to see advisory predictions.</p>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ minWidth: "48rem" }}>
            <thead>
              <tr>
                <th>Match</th>
                <th>λ 1H</th>
                <th>λ 2H</th>
                <th>P(1H&gt;2H)</th>
                <th>P(=)</th>
                <th>P(2H&gt;1H)</th>
                <th>Lean</th>
                <th>Conf.</th>
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

function TeamRow({ row }: { row: ConcededHalfTeamStats }) {
  return (
    <tr>
      <td>
        <strong>{row.team}</strong>
        <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
          {row.league}
          {row.season !== "all" ? ` · ${row.season}` : ""} · n=
          {row.liveMatches != null
            ? `${row.liveMatches} live${row.seedMatches ? `+${Math.round(row.seedMatches)} seed` : ""}`
            : row.matchesPlayed}
          {row.seedSource ? ` · ${row.seedSource}` : ""}
        </div>
      </td>
      <td>{row.avgConceded.toFixed(2)}</td>
      <td>{row.avg1hConceded.toFixed(2)}</td>
      <td>{row.avg2hConceded.toFixed(2)}</td>
      <td>{pct(row.conc1hGt2hPct)}</td>
      <td>{pct(row.conc1hEq2hPct)}</td>
      <td>{pct(row.conc2hGt1hPct)}</td>
      <td>{pct(row.cleanSheet1hPct)}</td>
      <td>{pct(row.cleanSheet2hPct)}</td>
      <td style={profileStyle(row.profile)}>{row.profile}</td>
      <td>
        <span className="badge" style={confidenceStyle(row.confidence)}>
          {row.confidence}
        </span>
      </td>
    </tr>
  );
}

function PredictionRow({
  prediction: p,
  expanded,
  onToggle,
}: {
  prediction: ConcededHalfPrediction;
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
        <td>{pctProb(p.p1hGreater)}</td>
        <td>{pctProb(p.pEqual)}</td>
        <td>{pctProb(p.p2hGreater)}</td>
        <td>{recommendationLabel(p.recommendation)}</td>
        <td>
          <span className="badge" style={confidenceStyle(p.confidence)}>
            {p.confidence}
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

function DetailPanel({ prediction: p }: { prediction: ConcededHalfPrediction }) {
  const d = p.detail;
  return (
    <div style={{ display: "grid", gap: "0.5rem", fontSize: "0.8125rem" }}>
      <strong>
        {p.homeTeam} vs {p.awayTeam}
      </strong>
      <div>
        Expected team goals — home 1H/2H {p.expHome1h.toFixed(2)} / {p.expHome2h.toFixed(2)} · away{" "}
        {p.expAway1h.toFixed(2)} / {p.expAway2h.toFixed(2)}
      </div>
      <div>
        Home scored {d.homeAvg1hScored.toFixed(2)}/{d.homeAvg2hScored.toFixed(2)} · conceded{" "}
        {d.homeAvg1hConceded.toFixed(2)}/{d.homeAvg2hConceded.toFixed(2)} (n={p.sampleSizeHome}
        {d.usedVenueSplitHome ? ", home venue" : ", all venues"})
      </div>
      <div>
        Away scored {d.awayAvg1hScored.toFixed(2)}/{d.awayAvg2hScored.toFixed(2)} · conceded{" "}
        {d.awayAvg1hConceded.toFixed(2)}/{d.awayAvg2hConceded.toFixed(2)} (n={p.sampleSizeAway}
        {d.usedVenueSplitAway ? ", away venue" : ", all venues"})
      </div>
      {(d.seedBlendHome || d.seedBlendAway || d.coldStartNote) && (
        <div style={{ color: "var(--muted)" }}>
          {d.seedBlendHome || d.seedBlendAway
            ? [d.seedBlendHome, d.seedBlendAway].filter(Boolean).join(" · ")
            : d.coldStartNote}
        </div>
      )}
      {p.confidence === "low" && (
        <p style={{ margin: "0.25rem 0 0", color: "var(--warn)" }}>
          Low confidence warning — informational only. Match stays available; nothing is blocked.
        </p>
      )}
    </div>
  );
}
