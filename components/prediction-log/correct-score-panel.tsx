"use client";

import { ScoreGridHeatmap } from "./score-grid-heatmap";
import { CorrectScoreHonestyNote } from "./correct-score-honesty-note";
import {
  analyzeCorrectScore,
  formatScoreline,
  isHighConcentration,
  isLowConcentration,
  type CorrectScoreAnalysis,
} from "@/lib/prediction-log/correct-score";

interface CorrectScorePanelProps {
  grid: number[][] | null | undefined;
  label?: string;
}

export function CorrectScorePanel({ grid, label }: CorrectScorePanelProps) {
  if (!grid?.length) {
    return (
      <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: "0.5rem 0 0" }}>
        Correct score estimates need club history for a Dixon-Coles grid.
      </p>
    );
  }

  const analysis = analyzeCorrectScore(grid);
  if (!analysis) return null;

  return (
    <div style={{ marginTop: "0.75rem" }}>
      {label ? (
        <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.35rem" }}>{label}</div>
      ) : null}
      <div style={{ fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.25rem" }}>
        Most likely score: {formatScoreline(analysis.mostLikely.home, analysis.mostLikely.away)} —{" "}
        {analysis.mostLikely.probPct}%
      </div>
      <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: "0 0 0.75rem" }}>
        Low individual probability is normal for correct score.
      </p>

      <CorrectScoreTable analysis={analysis} />

      <div
        style={{
          marginTop: "0.75rem",
          display: "grid",
          gap: "0.35rem",
          fontSize: "0.8125rem",
        }}
      >
        <SignalRow
          label="1X2 from grid"
          value={`Home ${analysis.resultProbs.home}% · Draw ${analysis.resultProbs.draw}% · Away ${analysis.resultProbs.away}%`}
        />
        <SignalRow
          label="Concentration (top 3)"
          value={`${analysis.concentrationIndex}%`}
          hint={
            isHighConcentration(analysis.concentrationIndex)
              ? "Predictable scoreline spread"
              : isLowConcentration(analysis.concentrationIndex)
                ? "Chaotic — widen confidence"
                : undefined
          }
        />
        {analysis.winningMargin ? (
          <SignalRow
            label="Most likely margin"
            value={`${analysis.winningMargin.label} (${analysis.winningMargin.probPct}%)`}
          />
        ) : null}
        <SignalRow
          label="Clean sheets"
          value={`Home ${analysis.cleanSheets.home}% · Away ${analysis.cleanSheets.away}%`}
        />
      </div>

      {analysis.scoresToAvoid.length > 0 ? (
        <div style={{ marginTop: "0.75rem" }}>
          <div className="label" style={{ marginBottom: "0.35rem" }}>
            Scores to avoid
          </div>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.8125rem" }}>
            {analysis.scoresToAvoid.map((s) => (
              <li key={`${s.home}-${s.away}`} style={{ marginBottom: "0.25rem" }}>
                {formatScoreline(s.home, s.away)} ({s.probPct}%) — {s.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div style={{ marginTop: "0.75rem" }}>
        <div className="label" style={{ marginBottom: "0.35rem" }}>
          Scoreline heatmap
        </div>
        <ScoreGridHeatmap
          grid={analysis.displayGrid}
          highlightCell={analysis.topCell}
        />
      </div>

      <CorrectScoreHonestyNote compact />
    </div>
  );
}

function CorrectScoreTable({ analysis }: { analysis: CorrectScoreAnalysis }) {
  return (
    <table style={{ width: "100%", fontSize: "0.8125rem", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ textAlign: "left", color: "var(--muted)" }}>
          <th style={{ padding: "0.25rem 0.5rem 0.25rem 0" }}>Rank</th>
          <th style={{ padding: "0.25rem 0.5rem" }}>Score</th>
          <th style={{ padding: "0.25rem 0.5rem" }}>Probability</th>
          <th style={{ padding: "0.25rem 0.5rem" }}>Fair odds</th>
        </tr>
      </thead>
      <tbody>
        {analysis.top6.map((row) => (
          <tr key={`${row.home}-${row.away}`}>
            <td style={{ padding: "0.25rem 0.5rem 0.25rem 0" }}>{row.rank}</td>
            <td style={{ padding: "0.25rem 0.5rem" }}>{formatScoreline(row.home, row.away)}</td>
            <td style={{ padding: "0.25rem 0.5rem" }}>{row.probPct}%</td>
            <td style={{ padding: "0.25rem 0.5rem" }}>{row.fairOdds.toFixed(2)}</td>
          </tr>
        ))}
        <tr style={{ color: "var(--muted)" }}>
          <td style={{ padding: "0.25rem 0.5rem 0.25rem 0" }}>—</td>
          <td style={{ padding: "0.25rem 0.5rem" }}>Other scores</td>
          <td style={{ padding: "0.25rem 0.5rem" }}>{analysis.otherProbPct}%</td>
          <td style={{ padding: "0.25rem 0.5rem" }}>—</td>
        </tr>
      </tbody>
    </table>
  );
}

function SignalRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <span style={{ color: "var(--muted)" }}>{label}: </span>
      <span>{value}</span>
      {hint ? <span style={{ color: "var(--warn)", marginLeft: "0.35rem" }}>({hint})</span> : null}
    </div>
  );
}

export function CorrectScoreOneLiner({
  snapshot,
}: {
  snapshot: { home: number; away: number; probPct: number } | null | undefined;
}) {
  if (!snapshot) return null;
  return (
    <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
      Most likely: {formatScoreline(snapshot.home, snapshot.away)} ({snapshot.probPct}%)
    </p>
  );
}
