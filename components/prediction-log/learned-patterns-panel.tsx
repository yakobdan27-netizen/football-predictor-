"use client";

import type { LearnerPatterns } from "@/lib/prediction-log/learner-patterns";
import { ODDS_BAND_LABELS } from "@/lib/prediction-log/odds-bands";
import type { OddsBandId } from "@/lib/prediction-log/types";

interface LearnedPatternsPanelProps {
  patterns: LearnerPatterns;
}

export function LearnedPatternsPanel({ patterns }: LearnedPatternsPanelProps) {
  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Learned patterns</h3>

      <div style={{ display: "grid", gap: "1rem" }}>
        <div>
          <div className="stat-label">Best-performing odds range</div>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem" }}>
            {patterns.bestOddsBand
              ? ODDS_BAND_LABELS[patterns.bestOddsBand as OddsBandId]
              : "Not enough data yet"}
          </p>
        </div>

        <div>
          <div className="stat-label">Weakest odds range</div>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem", color: "var(--warn)" }}>
            {patterns.worstOddsBand
              ? ODDS_BAND_LABELS[patterns.worstOddsBand as OddsBandId]
              : "Not enough data yet"}
          </p>
        </div>

        {patterns.topMarkets.length > 0 && (
          <div>
            <div className="stat-label">Most-won prediction types</div>
            <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem", fontSize: "0.875rem" }}>
              {patterns.topMarkets.slice(0, 3).map((m) => (
                <li key={m.market}>
                  {m.label}: {m.winRate}% ({m.wins}W / {m.losses}L)
                </li>
              ))}
            </ul>
          </div>
        )}

        {patterns.weakestMarkets.length > 0 && (
          <div>
            <div className="stat-label">Most-lost prediction types</div>
            <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem", fontSize: "0.875rem" }}>
              {patterns.weakestMarkets.slice(0, 3).map((m) => (
                <li key={m.market}>
                  {m.label}: {m.winRate}% ({m.wins}W / {m.losses}L)
                </li>
              ))}
            </ul>
          </div>
        )}

        {patterns.matchupTendencies.length > 0 && (
          <div>
            <div className="stat-label">Club matchup tendencies</div>
            <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem", fontSize: "0.875rem" }}>
              {patterns.matchupTendencies.slice(0, 5).map((m) => (
                <li key={`${m.league}-${m.homeTeam}-${m.awayTeam}`}>
                  {m.homeTeam} vs {m.awayTeam} ({m.league}):{" "}
                  {m.winRate != null ? `${m.winRate}%` : "—"} over {m.sample} picks
                </li>
              ))}
            </ul>
          </div>
        )}

        {patterns.batchPatterns.some((b) => b.totalBatches > 0) && (
          <div>
            <div className="stat-label">Batch combined-odds patterns</div>
            <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem", fontSize: "0.875rem" }}>
              {patterns.batchPatterns
                .filter((b) => b.totalBatches > 0)
                .map((b) => (
                  <li key={b.label}>
                    {b.label}: {b.winRate != null ? `${b.winRate}%` : "—"} (
                    {b.winningBatches}/{b.totalBatches} batches)
                    {b.lowSample && " · low sample"}
                  </li>
                ))}
            </ul>
          </div>
        )}

        {patterns.luckyNumberPerformance.length > 0 && (
          <div>
            <div className="stat-label">Lucky-number performance</div>
            <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem", fontSize: "0.875rem" }}>
              {patterns.luckyNumberPerformance.map((l) => (
                <li key={l.number}>
                  #{l.number}:{" "}
                  {l.sample > 0 ? `${l.winRate}% (${l.wins}W / ${l.losses}L)` : "No matching picks yet"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
