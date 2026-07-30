"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LIVE_SYNC_LEAGUES } from "@/lib/live/constants";
import type {
  LiveEventDto,
  LiveFixtureDto,
  LiveSourceConflictDto,
  LiveSyncMetaDto,
  LiveTab,
} from "@/lib/live/types";

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

function hasScoreConflict(conflicts?: LiveSourceConflictDto[]): boolean {
  if (!conflicts?.length) return false;
  return conflicts.some(
    (c) => c.field === "homeGoals" || c.field === "awayGoals"
  );
}

function formatConflictHint(conflicts?: LiveSourceConflictDto[]): string {
  if (!conflicts?.length) return "";
  return conflicts
    .map(
      (c) =>
        `${c.field}: API-Football ${String(c.apiFootball)} vs Stats API ${String(c.beSoccer)}`
    )
    .join(" · ");
}

function hasAnyStats(f: LiveFixtureDto): boolean {
  return (
    f.homeCorners != null ||
    f.awayCorners != null ||
    f.homeShots != null ||
    f.awayShots != null ||
    f.homePossession != null ||
    f.awayPossession != null
  );
}

export function LiveFixturesApp() {
  const [tab, setTab] = useState<LiveTab>("live");
  const [league, setLeague] = useState<string | null>(null);
  const [fixtures, setFixtures] = useState<LiveFixtureDto[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [syncMeta, setSyncMeta] = useState<LiveSyncMetaDto | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailEvents, setDetailEvents] = useState<LiveEventDto[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [authHint, setAuthHint] = useState(false);

  const [detailFixtureOverride, setDetailFixtureOverride] =
    useState<LiveFixtureDto | null>(null);

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
          syncMeta?: LiveSyncMetaDto | null;
        };
        if (!res.ok && !data.fixtures) {
          throw new Error(data.error ?? "Failed to load");
        }
        setFixtures(data.fixtures ?? []);
        setSyncedAt(data.syncedAt ?? data.syncMeta?.lastSyncAt ?? null);
        setSyncMeta(data.syncMeta ?? null);
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

  async function runSyncNow() {
    setSyncing(true);
    setToast(null);
    setAuthHint(false);
    try {
      const res = await fetch("/api/sync/run?scope=schedule", {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        fetched?: number;
        inserted?: number;
        updated?: number;
        skipped?: number;
        errors?: string[];
        reason?: string;
        status?: string;
        error?: string;
      };
      if (res.status === 401) {
        setAuthHint(true);
        setToast("Admin unlock required to sync.");
        return;
      }
      if (res.status === 503 && data.error?.includes("ADMIN_SECRET")) {
        setToast(data.error);
        return;
      }
      const fetched = data.fetched ?? 0;
      const inserted = data.inserted ?? 0;
      const updated = data.updated ?? 0;
      const errN = data.errors?.length ?? 0;
      setToast(
        data.reason ??
          `Sync: fetched ${fetched}, inserted ${inserted}, updated ${updated}` +
            (errN ? `, errors ${errN}` : "")
      );
      await load({ silent: true });
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  // Auto live-poll (35s) removed — use /live/refresh for manual runs.

  useEffect(() => {
    if (detailId == null) {
      setDetailEvents(null);
      setDetailFixtureOverride(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/live/fixtures/${detailId}`);
        const data = (await res.json()) as {
          events?: LiveEventDto[];
          fixture?: LiveFixtureDto;
        };
        if (!cancelled) {
          setDetailEvents(data.events ?? []);
          if (data.fixture) setDetailFixtureOverride(data.fixture);
        }
      } catch {
        if (!cancelled) {
          setDetailEvents([]);
          setDetailFixtureOverride(null);
        }
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

  const detailFixture =
    detailFixtureOverride ??
    fixtures.find((f) => f.fixtureId === detailId) ??
    null;

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
            Live mirror of API-Football, enriched with The Stats API match stats when
            configured — not linked to Prediction Log.{" "}
            <Link href="/live/refresh" style={{ textDecoration: "underline" }}>
              Manual refresh
            </Link>
          </p>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            alignItems: "center",
          }}
        >
          <Link href="/live/refresh" className="btn btn-secondary">
            Refresh scores
          </Link>
          <button
            type="button"
            className="btn btn-primary"
            disabled={syncing}
            onClick={() => void runSyncNow()}
          >
            {syncing ? "Syncing…" : "Sync Now"}
          </button>
          <div
            className="badge"
            style={{
              background: stale ? "rgba(245,158,11,0.15)" : "var(--surface2)",
              color: stale ? "var(--warn)" : "var(--muted)",
              border: `1px solid ${stale ? "var(--warn)" : "var(--border)"}`,
            }}
          >
            {stale ? "stale · " : ""}
            {formatAgo(syncMeta?.lastSyncAt ?? syncedAt)}
          </div>
        </div>
      </div>

      {toast && (
        <div
          className={
            authHint || /fail|invalid|quota|error/i.test(toast)
              ? "alert alert-error"
              : "alert"
          }
          style={{ marginBottom: "0.75rem" }}
        >
          {toast}
          {authHint && (
            <>
              {" "}
              <Link href="/admin/manual-results" style={{ textDecoration: "underline" }}>
                Unlock admin
              </Link>
            </>
          )}
        </div>
      )}

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
        <EmptyState
          syncMeta={syncMeta}
          syncing={syncing}
          onSync={() => void runSyncNow()}
        />
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
                  {hasScoreConflict(detailFixture.sourceConflicts) && (
                    <span
                      title={formatConflictHint(detailFixture.sourceConflicts)}
                      style={{
                        marginLeft: "0.5rem",
                        color: "var(--warn)",
                        fontWeight: 600,
                        fontSize: "0.75rem",
                      }}
                    >
                      score mismatch
                    </span>
                  )}
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
                {hasAnyStats(detailFixture) && (
                  <div
                    style={{
                      marginBottom: "0.75rem",
                      fontSize: "0.8125rem",
                      display: "grid",
                      gap: "0.25rem",
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>Match stats</div>
                    {(detailFixture.homeCorners != null ||
                      detailFixture.awayCorners != null) && (
                      <div>
                        Corners: {dash(detailFixture.homeCorners)} –{" "}
                        {dash(detailFixture.awayCorners)}
                      </div>
                    )}
                    {(detailFixture.homeShots != null ||
                      detailFixture.awayShots != null) && (
                      <div>
                        Shots: {dash(detailFixture.homeShots)} –{" "}
                        {dash(detailFixture.awayShots)}
                      </div>
                    )}
                    {(detailFixture.homePossession != null ||
                      detailFixture.awayPossession != null) && (
                      <div>
                        Possession: {dash(detailFixture.homePossession)}% –{" "}
                        {dash(detailFixture.awayPossession)}%
                      </div>
                    )}
                  </div>
                )}
                {!!detailFixture.sourceConflicts?.length && (
                  <p
                    style={{
                      margin: "0 0 0.75rem",
                      fontSize: "0.75rem",
                      color: "var(--warn)",
                    }}
                    title={formatConflictHint(detailFixture.sourceConflicts)}
                  >
                    Source mismatch:{" "}
                    {formatConflictHint(detailFixture.sourceConflicts)}
                  </p>
                )}
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

function EmptyState({
  syncMeta,
  syncing,
  onSync,
}: {
  syncMeta: LiveSyncMetaDto | null;
  syncing: boolean;
  onSync: () => void;
}) {
  const neverSynced = !syncMeta?.lastSyncAt;
  const failed =
    syncMeta?.status === "error" ||
    syncMeta?.status === "quota" ||
    syncMeta?.status === "auth";
  const from = syncMeta?.from;
  const to = syncMeta?.to;

  let title: string;
  let detail: string | null = null;
  if (neverSynced) {
    title = "No sync has run. Tap Sync Now.";
  } else if (failed) {
    title = `Last sync failed: ${syncMeta?.reason ?? "unknown error"}.`;
  } else {
    title =
      from && to
        ? `No matches scheduled between ${from} and ${to}.`
        : "No matches scheduled in the next 7 days.";
    detail = syncMeta?.lastSyncAt
      ? `Last sync: ${new Date(syncMeta.lastSyncAt).toLocaleString()}`
      : null;
  }

  return (
    <div className="card">
      <p style={{ margin: "0 0 0.75rem", color: "var(--muted)" }}>{title}</p>
      {detail && (
        <p
          style={{
            margin: "0 0 0.75rem",
            fontSize: "0.8125rem",
            color: "var(--muted)",
          }}
        >
          {detail}
        </p>
      )}
      {(neverSynced || failed) && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={syncing}
          onClick={onSync}
        >
          {syncing ? "Syncing…" : neverSynced ? "Sync Now" : "Retry"}
        </button>
      )}
      {neverSynced && (
        <p
          style={{
            margin: "0.75rem 0 0",
            fontSize: "0.75rem",
            color: "var(--muted)",
          }}
        >
          Requires{" "}
          <Link href="/admin/manual-results" style={{ textDecoration: "underline" }}>
            admin unlock
          </Link>
          .
        </p>
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
          {hasScoreConflict(fixture.sourceConflicts) && (
            <span
              title={formatConflictHint(fixture.sourceConflicts)}
              aria-label="Score source mismatch"
              style={{
                display: "inline-block",
                marginLeft: "0.25rem",
                width: "0.4rem",
                height: "0.4rem",
                borderRadius: "999px",
                background: "var(--warn)",
                verticalAlign: "middle",
              }}
            />
          )}
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
