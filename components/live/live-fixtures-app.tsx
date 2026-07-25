"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LIVE_SYNC_LEAGUES } from "@/lib/live/constants";
import type { LiveEventDto, LiveFixtureDto, LiveTab } from "@/lib/live/types";

const TABS: { id: LiveTab; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "finished", label: "Finished" },
];

function dash(v: number | string | null | undefined): string {
  if (v == null || v === "") return "—";
  return String(v);
}

function formatLocalKickoff(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { date: iso.slice(0, 10), time: "—" };
  }
  return {
    date: d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
    time: d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

function formatAgo(iso: string | null): string {
  if (!iso) return "never synced";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `updated ${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `updated ${m}m ago`;
  const h = Math.floor(m / 60);
  return `updated ${h}h ago`;
}

function scoreLine(f: LiveFixtureDto): string {
  if (f.homeGoals == null && f.awayGoals == null) return "—";
  return `${dash(f.homeGoals)} – ${dash(f.awayGoals)}`;
}

export function LiveFixturesApp() {
  const [tab, setTab] = useState<LiveTab>("live");
  const [league, setLeague] = useState<string | null>(null);
  const [fixtures, setFixtures] = useState<LiveFixtureDto[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailEvents, setDetailEvents] = useState<LiveEventDto[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const q = new URLSearchParams({ tab });
        if (league) q.set("league", league);
        const res = await fetch(`/api/live/fixtures?${q}`);
        const data = (await res.json()) as {
          ok?: boolean;
          fixtures?: LiveFixtureDto[];
          syncedAt?: string | null;
          stale?: boolean;
          error?: string;
        };
        if (!res.ok && !data.fixtures) {
          throw new Error(data.error ?? "Failed to load");
        }
        setFixtures(data.fixtures ?? []);
        setSyncedAt(data.syncedAt ?? null);
        setStale(Boolean(data.stale) || !res.ok);
        setFetchError(res.ok ? null : data.error ?? "API unavailable");
      } catch (e) {
        setFetchError(e instanceof Error ? e.message : "Failed to load");
        setStale(true);
        // Keep previous fixtures — no crash
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [tab, league]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab !== "live") return;
    const id = window.setInterval(() => {
      void load({ silent: true });
    }, 35_000);
    return () => window.clearInterval(id);
  }, [tab, load]);

  useEffect(() => {
    if (detailId == null) {
      setDetailEvents(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/live/fixtures/${detailId}`);
        const data = (await res.json()) as { events?: LiveEventDto[] };
        if (!cancelled) setDetailEvents(data.events ?? []);
      } catch {
        if (!cancelled) setDetailEvents([]);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailId]);

  const grouped = useMemo(() => {
    if (tab !== "upcoming") return null;
    const map = new Map<string, LiveFixtureDto[]>();
    for (const f of fixtures) {
      const key = new Date(f.kickoffUtc).toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
      const list = map.get(key) ?? [];
      list.push(f);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [fixtures, tab]);

  const detailFixture = fixtures.find((f) => f.fixtureId === detailId) ?? null;

  return (
    <div>
      <style>{`
        @keyframes live-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.45; transform: scale(0.85); }
        }
        .live-dot {
          width: 0.5rem;
          height: 0.5rem;
          border-radius: 999px;
          background: var(--danger);
          display: inline-block;
          animation: live-pulse 1.2s ease-in-out infinite;
        }
      `}</style>

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
          <h1 className="page-title">Live &amp; Fixtures</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            Read-only mirror of API-Football — not linked to Prediction Log.
          </p>
        </div>
        <div
          className="badge"
          style={{
            background: stale ? "rgba(245,158,11,0.15)" : "var(--surface2)",
            color: stale ? "var(--warn)" : "var(--muted)",
            border: `1px solid ${stale ? "var(--warn)" : "var(--border)"}`,
          }}
        >
          {stale ? "stale · " : ""}
          {formatAgo(syncedAt)}
        </div>
      </div>

      {fetchError && (
        <div className="alert alert-error" style={{ marginBottom: "0.75rem" }}>
          {fetchError} — showing last cached data if available.
        </div>
      )}

      <div
        role="tablist"
        aria-label="Fixture tab"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.35rem",
          marginBottom: "0.75rem",
        }}
      >
        {TABS.map((t) => {
          const selected = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className="btn"
              onClick={() => setTab(t.id)}
              style={{
                background: selected ? "var(--accent)" : "var(--surface2)",
                color: selected ? "#fff" : "var(--text)",
                border: "none",
                fontSize: "0.8125rem",
                padding: "0.45rem 0.75rem",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.35rem",
          marginBottom: "1rem",
        }}
      >
        <button
          type="button"
          className="btn"
          onClick={() => setLeague(null)}
          style={{
            background: league == null ? "var(--accent2)" : "var(--surface2)",
            color: league == null ? "#fff" : "var(--text)",
            border: "none",
            fontSize: "0.75rem",
            padding: "0.35rem 0.65rem",
          }}
        >
          All
        </button>
        {LIVE_SYNC_LEAGUES.map((l) => {
          const selected = league === l;
          return (
            <button
              key={l}
              type="button"
              className="btn"
              onClick={() => setLeague(l)}
              style={{
                background: selected ? "var(--accent2)" : "var(--surface2)",
                color: selected ? "#fff" : "var(--text)",
                border: "none",
                fontSize: "0.75rem",
                padding: "0.35rem 0.65rem",
              }}
            >
              {l}
            </button>
          );
        })}
      </div>

      {loading && fixtures.length === 0 && (
        <p className="page-sub">Loading fixtures…</p>
      )}

      {!loading && fixtures.length === 0 && (
        <div className="card">
          <p style={{ margin: 0, color: "var(--muted)" }}>
            No fixtures in this view. Sync runs on a schedule (daily / hourly /
            live poll).
          </p>
        </div>
      )}

      {tab === "upcoming" && grouped
        ? grouped.map(([dateLabel, rows]) => (
            <div key={dateLabel} style={{ marginBottom: "1.25rem" }}>
              <h2
                style={{
                  fontSize: "0.875rem",
                  fontWeight: 700,
                  color: "var(--muted)",
                  margin: "0 0 0.5rem",
                }}
              >
                {dateLabel}
              </h2>
              <div style={{ display: "grid", gap: "0.65rem" }}>
                {rows.map((f) => (
                  <FixtureRow
                    key={f.fixtureId}
                    fixture={f}
                    tab={tab}
                    onOpen={() => setDetailId(f.fixtureId)}
                  />
                ))}
              </div>
            </div>
          ))
        : (
          <div style={{ display: "grid", gap: "0.65rem" }}>
            {fixtures.map((f) => (
              <FixtureRow
                key={f.fixtureId}
                fixture={f}
                tab={tab}
                onOpen={() => setDetailId(f.fixtureId)}
              />
            ))}
          </div>
        )}

      {detailId != null && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 80,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: "1rem",
          }}
          onClick={() => setDetailId(null)}
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: "28rem",
              maxHeight: "80dvh",
              overflow: "auto",
              marginBottom: "var(--nav-height)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "0.5rem",
                marginBottom: "0.75rem",
              }}
            >
              <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>
                Match detail
              </h2>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDetailId(null)}
              >
                Close
              </button>
            </div>
            {detailFixture && (
              <>
                <p style={{ margin: "0 0 0.35rem", fontWeight: 600 }}>
                  {detailFixture.homeTeam} vs {detailFixture.awayTeam}
                </p>
                <p style={{ margin: "0 0 0.35rem", color: "var(--muted)" }}>
                  {scoreLine(detailFixture)} · {detailFixture.status}
                  {detailFixture.statusMinute != null
                    ? ` · ${detailFixture.statusMinute}'`
                    : ""}
                </p>
                <p
                  style={{
                    margin: "0 0 0.75rem",
                    fontSize: "0.8125rem",
                    color: "var(--muted)",
                  }}
                >
                  {dash(detailFixture.venue)} ·{" "}
                  {formatLocalKickoff(detailFixture.kickoffUtc).date}{" "}
                  {formatLocalKickoff(detailFixture.kickoffUtc).time}
                </p>
              </>
            )}
            <h3
              style={{
                fontSize: "0.8125rem",
                fontWeight: 700,
                margin: "0 0 0.5rem",
              }}
            >
              Events
            </h3>
            {detailLoading && (
              <p className="page-sub" style={{ margin: 0 }}>
                Loading…
              </p>
            )}
            {!detailLoading && detailEvents && detailEvents.length === 0 && (
              <p style={{ margin: 0, color: "var(--muted)" }}>—</p>
            )}
            {!detailLoading &&
              detailEvents &&
              detailEvents.length > 0 && (
                <ul
                  style={{
                    margin: 0,
                    padding: 0,
                    listStyle: "none",
                    display: "grid",
                    gap: "0.4rem",
                  }}
                >
                  {detailEvents.map((ev) => (
                    <li
                      key={ev.id}
                      style={{
                        fontSize: "0.8125rem",
                        display: "grid",
                        gridTemplateColumns: "2.5rem 1fr",
                        gap: "0.5rem",
                      }}
                    >
                      <span style={{ color: "var(--muted)" }}>
                        {ev.minute != null ? `${ev.minute}'` : "—"}
                      </span>
                      <span>
                        {dash(ev.type)}
                        {ev.player ? ` · ${ev.player}` : ""}
                        {ev.team ? ` (${ev.team})` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

function FixtureRow({
  fixture,
  tab,
  onOpen,
}: {
  fixture: LiveFixtureDto;
  tab: LiveTab;
  onOpen: () => void;
}) {
  const { date, time } = formatLocalKickoff(fixture.kickoffUtc);
  const live = tab === "live" || ["1H", "HT", "2H", "ET", "BT", "P"].includes(fixture.status);

  return (
    <button
      type="button"
      className="card"
      onClick={onOpen}
      style={{
        padding: "0.85rem",
        textAlign: "left",
        width: "100%",
        cursor: "pointer",
        border: "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
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
        {live && <span className="live-dot" aria-label="Live" />}
        <span>{fixture.leagueName ?? `League ${fixture.leagueId}`}</span>
        <span>
          {date} · {time}
        </span>
        <span
          className="badge"
          style={{
            background: "var(--surface2)",
            fontSize: "0.6875rem",
          }}
        >
          {fixture.status}
          {fixture.statusMinute != null ? ` ${fixture.statusMinute}'` : ""}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          gap: "0.5rem",
          alignItems: "center",
          fontWeight: 600,
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {fixture.homeTeam}
        </span>
        <span
          style={{
            fontVariantNumeric: "tabular-nums",
            minWidth: "3.5rem",
            textAlign: "center",
          }}
        >
          {scoreLine(fixture)}
        </span>
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textAlign: "right",
          }}
        >
          {fixture.awayTeam}
        </span>
      </div>
    </button>
  );
}
