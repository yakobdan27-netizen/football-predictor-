"use client";

import Link from "next/link";
import { useUpcomingPredictions } from "./upcoming-predictions-context";

export function UpcomingFixturesHeader() {
  const {
    fixtures,
    loading,
    refreshing,
    error,
    fixtureCountByLeague,
    refresh,
  } = useUpcomingPredictions();

  const leagueSummary = Object.entries(fixtureCountByLeague)
    .filter(([, n]) => n > 0)
    .map(([l, n]) => `${l} (${n})`)
    .join(" · ");

  return (
    <div
      className="card"
      style={{
        marginBottom: "1rem",
        display: "flex",
        flexWrap: "wrap",
        gap: "0.75rem",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div>
        <p style={{ margin: 0, fontSize: "0.8125rem", fontWeight: 600 }}>
          {loading
            ? "Loading upcoming fixtures…"
            : `${fixtures.length} upcoming fixture${fixtures.length === 1 ? "" : "s"} from API-Football`}
        </p>
        {leagueSummary ? (
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
            {leagueSummary}
          </p>
        ) : null}
        {error ? (
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.75rem", color: "var(--warn, #b45309)" }}>
            {error}
            {fixtures.length > 0 ? " Showing cached fixtures." : null}
          </p>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={loading || refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? "Refreshing…" : "Refresh fixtures"}
        </button>
        <Link href="/match-centre?tab=next-match" className="btn btn-secondary">
          Match Centre
        </Link>
      </div>
    </div>
  );
}
