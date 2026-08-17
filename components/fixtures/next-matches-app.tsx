"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchRecentResultsClient,
  fetchUpcomingLeagueClient,
  NEXT_MATCHES_LEAGUES,
  UPCOMING_API_UNAVAILABLE_COPY,
  type RecentMatchCentreResult,
} from "@/lib/football-api/fetch-upcoming-client";
import {
  type NextMatchesLeague,
  type UpcomingFixtureRow,
} from "@/lib/football-api/fetch-upcoming-league";

type LeagueState = {
  loading: boolean;
  error: string | null;
  season: number | null;
  fixtures: UpcomingFixtureRow[];
  fromCache?: boolean;
  filteredCount?: number;
};

function emptyLeagueState(): LeagueState {
  return { loading: true, error: null, season: null, fixtures: [] };
}

function formatKickoff(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { date: iso.slice(0, 10), time: "—" };
  }
  return {
    date: d.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
    time: d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

function TeamSide({
  name,
  logo,
  align,
}: {
  name: string;
  logo?: string | null;
  align: "left" | "right";
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        flex: 1,
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        minWidth: 0,
      }}
    >
      {align === "right" && (
        <span
          style={{
            fontWeight: 600,
            fontSize: "0.9rem",
            textAlign: "right",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
      )}
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt=""
          width={28}
          height={28}
          style={{ objectFit: "contain", flexShrink: 0 }}
        />
      ) : (
        <span
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: "var(--surface2)",
            flexShrink: 0,
          }}
        />
      )}
      {align === "left" && (
        <span
          style={{
            fontWeight: 600,
            fontSize: "0.9rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
      )}
    </div>
  );
}

const API_UNAVAILABLE_COPY = UPCOMING_API_UNAVAILABLE_COPY;

async function fetchLeague(
  league: NextMatchesLeague,
  refresh: boolean
): Promise<LeagueState> {
  const result = await fetchUpcomingLeagueClient(league, refresh);
  return {
    loading: false,
    error: result.error,
    season: result.season,
    fixtures: result.fixtures,
    fromCache: result.fromCache,
    filteredCount: result.filteredCount ?? 0,
  };
}

type RecentState = {
  loading: boolean;
  error: string | null;
  results: RecentMatchCentreResult[];
};

function emptyRecentState(): RecentState {
  return { loading: true, error: null, results: [] };
}

function scoreOrDash(v: number | null | undefined): string {
  if (v == null) return "—";
  return String(v);
}

function goalEventsOnly(goals: RecentMatchCentreResult["goals"]) {
  return goals.filter((g) => {
    const t = (g.type ?? "").toLowerCase();
    return t.includes("goal") && !t.includes("missed");
  });
}

function RecentResultCard({ row }: { row: RecentMatchCentreResult }) {
  const [open, setOpen] = useState(false);
  const { date, time } = formatKickoff(row.kickoffUtc);
  const goals = goalEventsOnly(row.goals);
  const ht =
    row.homeGoals1h != null && row.awayGoals1h != null
      ? `HT ${row.homeGoals1h}–${row.awayGoals1h}`
      : null;

  return (
    <div className="card" style={{ padding: "0.85rem", opacity: 0.95 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.35rem 0.75rem",
          alignItems: "center",
          marginBottom: "0.5rem",
          fontSize: "0.75rem",
          color: "var(--muted)",
        }}
      >
        <span style={{ fontWeight: 700, color: "var(--text)" }}>
          {date} · {time}
        </span>
        <span
          style={{
            padding: "0.15rem 0.45rem",
            borderRadius: 999,
            background: "var(--surface2)",
            fontWeight: 600,
          }}
        >
          {row.status}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          marginBottom: "0.35rem",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "0.9rem", flex: 1 }}>
          {row.homeTeam}
        </span>
        <span style={{ fontWeight: 800, fontSize: "1.05rem", flexShrink: 0 }}>
          {scoreOrDash(row.homeGoals)} – {scoreOrDash(row.awayGoals)}
        </span>
        <span
          style={{
            fontWeight: 600,
            fontSize: "0.9rem",
            flex: 1,
            textAlign: "right",
          }}
        >
          {row.awayTeam}
        </span>
      </div>
      <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.35rem" }}>
        {ht ? `${ht} · ` : ""}
        Corners {scoreOrDash(row.homeCorners)}–{scoreOrDash(row.awayCorners)}
      </div>
      {goals.length > 0 ? (
        <>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: "0.75rem", padding: "0.3rem 0.55rem" }}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide" : "Show"} goal timings ({goals.length})
          </button>
          {open ? (
            <ul
              style={{
                margin: "0.5rem 0 0",
                paddingLeft: "1.1rem",
                fontSize: "0.75rem",
                color: "var(--text)",
              }}
            >
              {goals.map((g, i) => (
                <li key={`${g.minute}-${g.team}-${i}`}>
                  {g.minute ?? "?"}&apos; {g.team ?? "—"}
                  {g.player ? ` (${g.player})` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function NextMatchesApp() {
  const router = useRouter();
  const [active, setActive] = useState<NextMatchesLeague>("Premier League");
  const [byLeague, setByLeague] = useState<Record<string, LeagueState>>(() => {
    const init: Record<string, LeagueState> = {};
    for (const l of NEXT_MATCHES_LEAGUES) init[l] = emptyLeagueState();
    return init;
  });
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentState>(emptyRecentState);

  const loadRecent = useCallback(async (league: NextMatchesLeague) => {
    setRecent((prev) => ({ ...prev, loading: true, error: null }));
    const { results, error } = await fetchRecentResultsClient(league);
    setRecent({ loading: false, error, results });
  }, []);

  const loadAll = useCallback(async (refresh: boolean) => {
    setByLeague((prev) => {
      const next = { ...prev };
      for (const l of NEXT_MATCHES_LEAGUES) {
        next[l] = { ...emptyLeagueState(), fixtures: refresh ? [] : prev[l]?.fixtures ?? [] };
      }
      return next;
    });
    const results = await Promise.all(
      NEXT_MATCHES_LEAGUES.map(async (league) => {
        const state = await fetchLeague(league, refresh);
        return [league, state] as const;
      })
    );
    setByLeague((prev) => {
      const next = { ...prev };
      for (const [league, state] of results) next[league] = state;
      return next;
    });
  }, []);

  useEffect(() => {
    void loadAll(false);
  }, [loadAll]);

  useEffect(() => {
    void loadRecent(active);
    const timer = window.setInterval(() => void loadRecent(active), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [active, loadRecent]);

  const state = byLeague[active] ?? emptyLeagueState();
  const totalFilteredCount = NEXT_MATCHES_LEAGUES.reduce(
    (n, league) => n + (byLeague[league]?.filteredCount ?? 0),
    0
  );

  async function openInDecisionMaker(row: UpcomingFixtureRow) {
    setOpenError(null);
    setOpeningId(row.apiFixtureId);
    try {
      const res = await fetch("/api/fixtures/open-in-dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiFixtureId: row.apiFixtureId,
          matchDate: row.matchDate,
          kickoffIso: row.kickoffIso,
          home: row.home,
          away: row.away,
          league: row.league,
          status: row.status,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        batchId?: string;
        apiFixtureId?: number;
      };
      if (!res.ok || !data.batchId) {
        throw new Error(data.error ?? "Could not open Decision Maker");
      }
      router.push(
        `/decision-maker?batch=${encodeURIComponent(data.batchId)}&fixture_id=${data.apiFixtureId ?? row.apiFixtureId}`
      );
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : "Could not open Decision Maker");
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: "1rem",
        }}
      >
        <div>
          <h1 className="page-title">Next Matches</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            Upcoming fixtures from API-Football — no date entry. Season{" "}
            {state.season != null ? `${state.season}/${String(state.season + 1).slice(2)}` : "…"}.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", alignItems: "flex-end" }}>
          <Link href="/upcoming-predictions" className="btn btn-primary">
            View predictions &amp; ladder →
          </Link>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={state.loading}
            onClick={() => void loadAll(true)}
          >
            {state.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {totalFilteredCount > 0 && (
        <p
          style={{
            padding: "0.65rem 0.85rem",
            marginBottom: "0.75rem",
            background: "rgba(234, 179, 8, 0.12)",
            borderRadius: 8,
            fontSize: "0.9rem",
          }}
        >
          {totalFilteredCount} non-league / out-of-roster fixtures hidden (men&apos;s
          top flight only).
        </p>
      )}

      <div
        role="tablist"
        aria-label="League"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.35rem",
          marginBottom: "1rem",
        }}
      >
        {NEXT_MATCHES_LEAGUES.map((league) => {
          const selected = active === league;
          return (
            <button
              key={league}
              type="button"
              role="tab"
              aria-selected={selected}
              className="btn"
              onClick={() => setActive(league)}
              style={{
                background: selected ? "var(--accent)" : "var(--surface2)",
                color: selected ? "#fff" : "var(--text)",
                border: "none",
                fontSize: "0.8125rem",
                padding: "0.45rem 0.75rem",
              }}
            >
              {league}
            </button>
          );
        })}
      </div>

      {openError && (
        <div className="alert alert-error" style={{ marginBottom: "0.75rem" }}>
          {openError}
        </div>
      )}

      {state.loading && state.fixtures.length === 0 && (
        <p className="page-sub">Loading upcoming fixtures…</p>
      )}

      {!state.loading && state.error && (
        <div className="alert alert-error" style={{ marginBottom: "0.75rem" }}>
          {state.error}
          {state.fixtures.length > 0 ? " Showing cached fixtures." : null}
        </div>
      )}

      {!state.loading && !state.error && state.fixtures.length === 0 && (
        <div className="card">
          <p style={{ margin: 0, color: "var(--muted)" }}>
            No upcoming matches found.
          </p>
        </div>
      )}

      <div style={{ display: "grid", gap: "0.65rem" }}>
        {state.fixtures.map((row) => {
          const { date, time } = formatKickoff(row.kickoffIso);
          const busy = openingId === row.apiFixtureId;
          return (
            <div key={row.apiFixtureId} className="card" style={{ padding: "0.85rem" }}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.35rem 0.75rem",
                  alignItems: "center",
                  marginBottom: "0.65rem",
                  fontSize: "0.75rem",
                  color: "var(--muted)",
                }}
              >
                <span style={{ fontWeight: 700, color: "var(--text)" }}>
                  {date} · {time}
                </span>
                <span
                  style={{
                    padding: "0.15rem 0.45rem",
                    borderRadius: 999,
                    background: "var(--surface2)",
                    fontWeight: 600,
                  }}
                >
                  {row.league}
                </span>
                {row.venue ? <span>{row.venue}</span> : null}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginBottom: "0.75rem",
                }}
              >
                <TeamSide name={row.home.name} logo={row.home.logo} align="left" />
                <span
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    color: "var(--muted)",
                    flexShrink: 0,
                  }}
                >
                  VS
                </span>
                <TeamSide name={row.away.name} logo={row.away.logo} align="right" />
              </div>

              <button
                type="button"
                className="btn btn-primary btn-full"
                disabled={busy}
                onClick={() => void openInDecisionMaker(row)}
              >
                {busy ? "Opening…" : "Open in Decision Maker"}
              </button>
            </div>
          );
        })}
      </div>

      <section style={{ marginTop: "1.75rem" }}>
        <h2 style={{ fontSize: "1rem", margin: "0 0 0.35rem" }}>Recent Results</h2>
        <p className="page-sub" style={{ marginBottom: "0.75rem" }}>
          Auto-filled when matches end (scores, corners, goal timings) — separate from
          Prediction Log.
        </p>
        {recent.loading && recent.results.length === 0 ? (
          <p className="page-sub">Loading recent results…</p>
        ) : null}
        {recent.error ? (
          <div className="alert alert-error" style={{ marginBottom: "0.75rem" }}>
            {recent.error}
          </div>
        ) : null}
        {!recent.loading && !recent.error && recent.results.length === 0 ? (
          <div className="card">
            <p style={{ margin: 0, color: "var(--muted)" }}>
              No finished matches in the last 48 hours for {active}.
            </p>
          </div>
        ) : null}
        <div style={{ display: "grid", gap: "0.65rem" }}>
          {recent.results.map((row) => (
            <RecentResultCard key={row.fixtureId} row={row} />
          ))}
        </div>
      </section>
    </div>
  );
}
