"use client";

import {
  RESEARCH_LEAGUE_PRIOR_SEEDS,
  type LeaguePriorRecord,
  type LeaguePriorsStore,
} from "@/lib/prediction-log/league-priors";

const BIG_FIVE_IDS = ["premier_league", "la_liga", "serie_a", "ligue_1"] as const;

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function LeaguePriorsCard({
  store,
  onRecompute,
}: {
  store: LeaguePriorsStore | null;
  onRecompute?: () => void;
}) {
  const rows: LeaguePriorRecord[] = BIG_FIVE_IDS.map((id) => {
    const fromStore = store?.priors[id];
    if (fromStore) return fromStore;
    const seed = RESEARCH_LEAGUE_PRIOR_SEEDS[id]!;
    return { ...seed, updatedAt: store?.updatedAt ?? new Date().toISOString() };
  });

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.75rem",
        }}
      >
        <h3 style={{ fontSize: "0.9375rem", fontWeight: 700, margin: 0 }}>
          League Priors
        </h3>
        {onRecompute ? (
          <button type="button" className="btn btn-secondary" onClick={onRecompute}>
            Sync priors to server
          </button>
        ) : null}
      </div>
      <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: "0 0 0.75rem" }}>
        Compact baselines for Decision Maker confidence, hybrid system score shrinkage, corners,
        and half-tempo. Research seeds (2021–26) are starting weights only — live results and
        trait overrides replace them. Never blocks a market.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)" }}>
              <th style={{ padding: "0.35rem 0.5rem" }}>League</th>
              <th style={{ padding: "0.35rem 0.5rem" }}>Over 2.5%</th>
              <th style={{ padding: "0.35rem 0.5rem" }}>BTTS%</th>
              <th style={{ padding: "0.35rem 0.5rem" }}>Corners</th>
              <th style={{ padding: "0.35rem 0.5rem" }}>Home factor</th>
              <th style={{ padding: "0.35rem 0.5rem" }}>Late goal%</th>
              <th style={{ padding: "0.35rem 0.5rem" }}>n</th>
              <th style={{ padding: "0.35rem 0.5rem" }}>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.leagueId} style={{ borderTop: "1px solid var(--border, #333)" }}>
                <td style={{ padding: "0.4rem 0.5rem", fontWeight: 600 }}>{r.leagueName}</td>
                <td style={{ padding: "0.4rem 0.5rem" }}>{fmt(r.over25_rate)}</td>
                <td style={{ padding: "0.4rem 0.5rem" }}>{fmt(r.btts_rate)}</td>
                <td style={{ padding: "0.4rem 0.5rem" }}>{fmt(r.avg_total_corners, 2)}</td>
                <td style={{ padding: "0.4rem 0.5rem" }}>{fmt(r.home_goal_factor, 2)}</td>
                <td style={{ padding: "0.4rem 0.5rem" }}>{fmt(r.late_goal_share)}</td>
                <td style={{ padding: "0.4rem 0.5rem" }}>{r.sample_size}</td>
                <td style={{ padding: "0.4rem 0.5rem" }}>{r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
