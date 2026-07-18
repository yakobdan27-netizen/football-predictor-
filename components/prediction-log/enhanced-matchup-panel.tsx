"use client";

import { useState } from "react";
import {
  AI_ENHANCED_MIN_SAMPLES,
  type EnhancedMatchupPrediction,
} from "@/lib/prediction-log/ai-enhanced-prediction";
import { LEAGUE_OPTIONS } from "@/lib/prediction-log/markets-config";
import type { LearnerStatsStore } from "@/lib/prediction-log/types";

interface EnhancedMatchupPanelProps {
  learnerStats: LearnerStatsStore;
}

export function EnhancedMatchupPanel({ learnerStats }: EnhancedMatchupPanelProps) {
  const [homeTeam, setHomeTeam] = useState("Manchester City");
  const [awayTeam, setAwayTeam] = useState("Everton");
  const [league, setLeague] = useState<string>(LEAGUE_OPTIONS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnhancedMatchupPrediction | null>(null);

  const samples = learnerStats.totalScoredPicks;
  const ready = samples >= AI_ENHANCED_MIN_SAMPLES;

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-prediction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeTeam, awayTeam, league, learnerStats }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Prediction failed");
      setResult(data as EnhancedMatchupPrediction);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Prediction failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <h3 style={{ fontSize: "1rem", marginBottom: "0.35rem" }}>Enhanced matchup preview</h3>
      <p style={{ fontSize: "0.8125rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
        Combines 2021–26 seed reference with your personal learner corrections when you have at least{" "}
        {AI_ENHANCED_MIN_SAMPLES} scored picks ({samples} so far).
      </p>
      <div
        style={{
          marginBottom: "0.75rem",
          height: 8,
          borderRadius: 4,
          background: "var(--border, #333)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, (samples / AI_ENHANCED_MIN_SAMPLES) * 100)}%`,
            background: ready ? "var(--accent)" : "var(--accent2)",
          }}
        />
      </div>
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
      <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void run()}>
        {loading ? "Running…" : ready ? "Get AI-enhanced prediction" : "Get reference prediction"}
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
                background:
                  result.mode === "ai_enhanced"
                    ? "color-mix(in srgb, var(--accent) 22%, transparent)"
                    : "color-mix(in srgb, var(--accent2) 20%, transparent)",
                color: result.mode === "ai_enhanced" ? "var(--accent)" : "var(--accent2)",
                fontWeight: 600,
                fontSize: "0.75rem",
              }}
            >
              {result.mode === "ai_enhanced" ? "AI Enhanced" : "Reference Only"}
            </span>
          </div>
          <div>
            Most likely: {result.mostLikelyScore} ({result.mostLikelyProbPct}%) · Expected{" "}
            {result.expectedScore}
          </div>
          <div>
            1X2: {result.winProbability.home}% / {result.winProbability.draw}% /{" "}
            {result.winProbability.away}%
          </div>
          <div>
            O/U 2.5: {result.overUnder25.over}% over · BTTS yes {result.bothTeamsToScore.yes}%
          </div>
          <div style={{ opacity: 0.75, fontSize: "0.8rem" }}>{result.enhancementNote}</div>
        </div>
      ) : null}
    </div>
  );
}
