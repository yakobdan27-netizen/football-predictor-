"use client";

import { describeEngineImpact } from "@/lib/prediction-log/league-character";
import type { League } from "@/lib/prediction-log/types";

interface LeagueEngineImpactProps {
  league: League | null;
}

export function LeagueEngineImpact({ league }: LeagueEngineImpactProps) {
  const rows = describeEngineImpact(league);

  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <h3 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "0.5rem" }}>
        How this affects predictions
      </h3>
      <p style={{ fontSize: "0.8125rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
        League character nudges P_signal, Dixon-Coles lambdas, tier boosts, and Bayesian interval width (capped at ±8%).
      </p>
      <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem", lineHeight: 1.55 }}>
        {rows.map((row) => (
          <li key={`${row.market}-${row.adjustment}`}>
            <strong>{row.market}:</strong> {row.adjustment}
          </li>
        ))}
      </ul>
    </div>
  );
}
