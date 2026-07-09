"use client";

import { confidenceBadgeLabel, generateFingerprintSentences } from "@/lib/prediction-log/league-fingerprint";
import type { CorrectScoreStats, League } from "@/lib/prediction-log/types";

interface LeagueFingerprintCardProps {
  league: League;
  correctScoreStats?: CorrectScoreStats | null;
}

export function LeagueFingerprintCard({ league, correctScoreStats }: LeagueFingerprintCardProps) {
  const sentences = generateFingerprintSentences(league);
  const leagueCs = correctScoreStats?.byLeague[league.leagueName];

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 700, margin: 0 }}>
            {league.leagueName}
          </h2>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "var(--muted)" }}>
            {league.season}
            {league.country ? ` · ${league.country}` : ""} · {league.matchesLogged} matches logged
          </p>
        </div>
        <span
          style={{
            fontSize: "0.75rem",
            fontWeight: 700,
            padding: "0.25rem 0.5rem",
            borderRadius: "6px",
            background:
              league.confidenceLevel === "high"
                ? "rgba(34,197,94,0.15)"
                : league.confidenceLevel === "medium"
                  ? "rgba(234,179,8,0.15)"
                  : "rgba(239,68,68,0.12)",
            color:
              league.confidenceLevel === "high"
                ? "var(--accent)"
                : league.confidenceLevel === "medium"
                  ? "var(--warn)"
                  : "var(--danger)",
          }}
        >
          {confidenceBadgeLabel(league.confidenceLevel)}
        </span>
      </div>

      {leagueCs && leagueCs.sample >= 5 ? (
        <p style={{ margin: "1rem 0 0", fontSize: "0.8125rem", color: "var(--muted)" }}>
          Top-3 correct score hit rate (this league):{" "}
          <strong style={{ color: "inherit" }}>
            {Math.round((leagueCs.top3Hits / leagueCs.sample) * 1000) / 10}%
          </strong>{" "}
          ({leagueCs.sample} settled matches)
        </p>
      ) : null}

      {sentences.length > 0 ? (
        <ul style={{ margin: "1rem 0 0", paddingLeft: "1.25rem", fontSize: "0.9rem", lineHeight: 1.5 }}>
          {sentences.map((s) => (
            <li key={s} style={{ marginBottom: "0.35rem" }}>
              {s}
            </li>
          ))}
        </ul>
      ) : (
        <p className="page-sub" style={{ marginTop: "1rem" }}>
          Log more match results (including half-time goals and timing) to generate a league fingerprint.
        </p>
      )}
    </div>
  );
}
