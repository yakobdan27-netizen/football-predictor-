"use client";

import { useState } from "react";
import type { LeagueMatchupAnalysis } from "@/lib/prediction-log/league-matchup-analysis";
import { LEAGUE_OPTIONS } from "@/lib/prediction-log/markets-config";

export function LeagueMatchupCard() {
  const [homeTeam, setHomeTeam] = useState("Manchester City");
  const [awayTeam, setAwayTeam] = useState("Everton");
  const [league, setLeague] = useState<string>(LEAGUE_OPTIONS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LeagueMatchupAnalysis | null>(null);

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ homeTeam, awayTeam, league });
      const res = await fetch(`/api/league-analysis?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      setResult(data as LeagueMatchupAnalysis);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <h3 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "0.35rem" }}>
        Reference matchup (2021–26 seeds)
      </h3>
      <p className="page-sub" style={{ marginBottom: "0.75rem" }}>
        Poisson / Dixon-Coles from scoring + conceded seed priors. Advisory only — never blocks picks.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "0.75rem",
          marginBottom: "0.75rem",
        }}
      >
        <div>
          <label className="label">Home</label>
          <input className="input" value={homeTeam} onChange={(e) => setHomeTeam(e.target.value)} />
        </div>
        <div>
          <label className="label">Away</label>
          <input className="input" value={awayTeam} onChange={(e) => setAwayTeam(e.target.value)} />
        </div>
        <div>
          <label className="label">League</label>
          <select className="input" value={league} onChange={(e) => setLeague(e.target.value)}>
            {LEAGUE_OPTIONS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void runAnalysis()}>
        {loading ? "Analysing…" : "Run reference analysis"}
      </button>
      {error ? (
        <p style={{ color: "var(--danger)", marginTop: "0.75rem", fontSize: "0.875rem" }}>{error}</p>
      ) : null}
      {result ? (
        <div style={{ marginTop: "1rem", fontSize: "0.875rem", display: "grid", gap: "0.35rem" }}>
          <div>
            <span
              style={{
                display: "inline-block",
                padding: "0.15rem 0.5rem",
                borderRadius: 4,
                background: "color-mix(in srgb, var(--accent2) 20%, transparent)",
                color: "var(--accent2)",
                fontWeight: 600,
                fontSize: "0.75rem",
              }}
            >
              Reference Only
            </span>
          </div>
          <div>
            <strong>
              {result.homeTeam} vs {result.awayTeam}
            </strong>
          </div>
          <div>
            Expected / most likely: {result.expectedScore} / {result.mostLikelyScore} (
            {result.mostLikelyProbPct}%)
          </div>
          <div>
            1X2: {result.winProbability.home}% / {result.winProbability.draw}% /{" "}
            {result.winProbability.away}%
          </div>
          <div>
            O/U 2.5: {result.overUnder25.over}% over · {result.overUnder25.under}% under
          </div>
          <div>
            BTTS: {result.bothTeamsToScore.yes}% yes · {result.bothTeamsToScore.no}% no
          </div>
          <div style={{ opacity: 0.7, fontSize: "0.8rem" }}>{result.source}</div>
        </div>
      ) : null}
    </div>
  );
}
