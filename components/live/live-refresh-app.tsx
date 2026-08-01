"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ManualRefreshSummary,
  RefreshFixtureResult,
  RefreshStep,
} from "@/lib/live/refresh-types";
import type { SampleDayMatch, SampleDayPreview } from "@/lib/live/sample-day-types";
import {
  SAMPLE_DATE_DEFAULT,
  isSampleDateAllowed,
  resolveSampleWindow,
  type SampleWindowBounds,
} from "@/lib/live/sample-window";

type MatchStatsResponse = {
  ok: boolean;
  error?: string;
  warning?: string;
  persisted?: boolean;
  persistedToMatchStats?: boolean;
  persistedToLiveFixtures?: boolean;
  source?: "database" | "api";
  hasNumericStats?: boolean;
  /** Present on API fetches (also stored on match_stats.raw_json). */
  rawJson?: string | null;
  fetched?: number;
  mapped?: number;
  matchStatsUpserted?: number;
  fixture?: {
    fixtureId: number;
    leagueName: string | null;
    homeTeam: string;
    awayTeam: string;
    status: string;
    kickoffUtc: string;
    homeGoals: number | null;
    awayGoals: number | null;
    besoccerMatchId: string | null;
    homeCorners: number | null;
    awayCorners: number | null;
    homeShots: number | null;
    awayShots: number | null;
    homePossession: number | null;
    awayPossession: number | null;
    homeShotsOnTarget: number | null;
    awayShotsOnTarget: number | null;
    homeXg: number | null;
    awayXg: number | null;
    homeBigChances: number | null;
    awayBigChances: number | null;
    homeGkSaves: number | null;
    awayGkSaves: number | null;
    homeFouls: number | null;
    awayFouls: number | null;
    homeYellowCards: number | null;
    awayYellowCards: number | null;
    homeRedCards: number | null;
    awayRedCards: number | null;
    homePasses: number | null;
    awayPasses: number | null;
    homeAccuratePasses: number | null;
    awayAccuratePasses: number | null;
    homeTackles: number | null;
    awayTackles: number | null;
    homeFreeKicks: number | null;
    awayFreeKicks: number | null;
    sourceConflicts: Array<{
      field: string;
      apiFootball: unknown;
      beSoccer: unknown;
    }>;
    lastSyncedUtc: string;
  };
};

type StatusProbe = {
  ok: boolean;
  configured?: boolean;
  error?: string;
  note?: string;
  lookbackDays?: number;
  matchesProbe?: {
    count?: number;
    dateFrom?: string;
    dateTo?: string;
  };
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function stepColor(status: RefreshStep["status"]): string {
  switch (status) {
    case "done":
      return "var(--accent2, #16a34a)";
    case "running":
      return "var(--accent)";
    case "error":
      return "var(--danger)";
    case "skipped":
      return "var(--muted)";
    default:
      return "var(--border)";
  }
}

function scoreLine(
  home: number | null | undefined,
  away: number | null | undefined
): string {
  if (home == null && away == null) return "—";
  return `${home ?? "—"} – ${away ?? "—"}`;
}

function score(f: RefreshFixtureResult): string {
  return scoreLine(f.homeGoals, f.awayGoals);
}

function monthLabel(year: number, monthIndex: number): string {
  return new Date(Date.UTC(year, monthIndex, 1)).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Monday-first weekday index for the 1st of the month (0=Mon … 6=Sun). */
function leadingBlanks(year: number, monthIndex: number): number {
  const dow = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay(); // 0=Sun
  return (dow + 6) % 7;
}

function parseYm(iso: string): { year: number; monthIndex: number } {
  const [y, m] = iso.split("-").map(Number);
  return { year: y!, monthIndex: m! - 1 };
}

export function LiveRefreshApp() {
  const [sampleDate, setSampleDate] = useState(SAMPLE_DATE_DEFAULT);
  const [calCursor, setCalCursor] = useState(() => parseYm(SAMPLE_DATE_DEFAULT));
  const [previewing, setPreviewing] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [preview, setPreview] = useState<SampleDayPreview | null>(null);
  const [result, setResult] = useState<ManualRefreshSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [besoccerStatus, setBesoccerStatus] = useState<StatusProbe | null>(null);
  const [sampleWindow, setSampleWindow] = useState<SampleWindowBounds>(() =>
    resolveSampleWindow(true)
  );
  const [afPlan, setAfPlan] = useState<string | null>(null);
  const [statsDialogMatch, setStatsDialogMatch] = useState<SampleDayMatch | null>(
    null
  );
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsPayload, setStatsPayload] = useState<MatchStatsResponse | null>(
    null
  );
  const [statsError, setStatsError] = useState<string | null>(null);

  const dateValid = isSampleDateAllowed(sampleDate, sampleWindow);
  const busy = previewing || fetching;
  const SAMPLE_DATE_MIN = sampleWindow.min;
  const SAMPLE_DATE_MAX = sampleWindow.max;

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/besoccer-status");
      const data = (await res.json()) as StatusProbe;
      setBesoccerStatus(data);
    } catch (e) {
      setBesoccerStatus({
        ok: false,
        configured: false,
        error: e instanceof Error ? e.message : "Status check failed",
      });
    }
    try {
      const afRes = await fetch("/api/bets/status");
      const af = (await afRes.json()) as {
        plan?: string;
        isFree?: boolean;
        limitDay?: number | null;
      };
      if (af.plan) setAfPlan(af.plan);
      const isFree =
        typeof af.isFree === "boolean"
          ? af.isFree
          : af.plan
            ? /^free$/i.test(af.plan)
            : af.limitDay != null
              ? af.limitDay <= 100
              : true;
      setSampleWindow(resolveSampleWindow(isFree));
    } catch {
      /* keep free window until status known */
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const loadMatches = useCallback(
    async (date: string, forceApi: boolean) => {
      if (!isSampleDateAllowed(date, sampleWindow)) {
        setError(`Pick a date between ${sampleWindow.min} and ${sampleWindow.max}`);
        return;
      }
      setPreviewing(true);
      setError(null);
      setResult(null);
      setPreview(null);
      try {
        const qs = new URLSearchParams({ date });
        if (forceApi) qs.set("force", "1");
        const res = await fetch(`/api/live/refresh/preview?${qs.toString()}`);
        const data = (await res.json()) as SampleDayPreview & {
          sampleWindow?: SampleWindowBounds;
          plan?: string;
        };
        if (data.sampleWindow) setSampleWindow(data.sampleWindow);
        if (data.plan) setAfPlan(data.plan);
        setPreview(data);
        if (!res.ok || !data.ok) {
          setError(data.error ?? "Preview failed");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Preview failed");
      } finally {
        setPreviewing(false);
      }
    },
    [sampleWindow]
  );

  // Selecting a calendar/input date loads DB-first (API only if empty).
  useEffect(() => {
    if (!isSampleDateAllowed(sampleDate, sampleWindow)) return;
    void loadMatches(sampleDate, false);
    // Only re-load when the chosen date changes (not when plan window updates).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sampleWindow used as gate only
  }, [sampleDate]);

  const calendarCells = useMemo(() => {
    const { year, monthIndex } = calCursor;
    const blanks = leadingBlanks(year, monthIndex);
    const total = daysInMonth(year, monthIndex);
    const cells: Array<{ iso: string | null; day: number | null }> = [];
    for (let i = 0; i < blanks; i++) cells.push({ iso: null, day: null });
    for (let d = 1; d <= total; d++) {
      const iso = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ iso, day: d });
    }
    return cells;
  }, [calCursor]);

  function shiftMonth(delta: number) {
    setCalCursor((prev) => {
      const d = new Date(Date.UTC(prev.year, prev.monthIndex + delta, 1));
      const year = d.getUTCFullYear();
      const monthIndex = d.getUTCMonth();
      const first = `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
      const lastDay = daysInMonth(year, monthIndex);
      const last = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      if (last < SAMPLE_DATE_MIN || first > SAMPLE_DATE_MAX) return prev;
      return { year, monthIndex };
    });
  }

  function pickDate(iso: string) {
    if (!isSampleDateAllowed(iso, sampleWindow)) return;
    setSampleDate(iso);
    setResult(null);
    setError(null);
  }

  function onDateInput(value: string) {
    setSampleDate(value);
    setResult(null);
    setError(null);
    if (isSampleDateAllowed(value, sampleWindow)) {
      setCalCursor(parseYm(value));
    }
  }

  async function openMatchStats(match: SampleDayMatch, forceApi = false) {
    setStatsDialogMatch(match);
    setStatsPayload(null);
    setStatsError(null);
    setStatsLoading(true);
    try {
      const qs = new URLSearchParams({
        fixtureId: String(match.fixtureId),
      });
      if (forceApi) qs.set("force", "1");
      const res = await fetch(`/api/live/refresh/match-stats?${qs.toString()}`, {
        method: "POST",
      });
      const data = (await res.json()) as MatchStatsResponse;
      setStatsPayload(data);
      if (!res.ok || !data.ok) {
        setStatsError(data.error ?? "Failed to load match stats");
      } else if (forceApi || data.persistedToMatchStats) {
        // Refresh list so hasMatchStats badges update
        void loadMatches(sampleDate, false);
      }
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : "Failed to load match stats");
    } finally {
      setStatsLoading(false);
    }
  }

  function closeMatchStats() {
    setStatsDialogMatch(null);
    setStatsPayload(null);
    setStatsError(null);
    setStatsLoading(false);
  }

  async function fetchMatchData() {
    if (!dateValid) {
      setError(`Pick a date between ${SAMPLE_DATE_MIN} and ${SAMPLE_DATE_MAX}`);
      return;
    }
    if (!preview?.matches.length) {
      setError("Load matches for the day first, then fetch stats.");
      return;
    }
    setFetching(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(
        `/api/live/refresh?mode=sample-day&date=${encodeURIComponent(sampleDate)}`,
        { method: "POST" }
      );
      const data = (await res.json()) as ManualRefreshSummary;
      setResult(data);
      if (!res.ok && !data.skippedRun) {
        setError(data.error ?? "Refresh failed");
      }
      await loadStatus();
      void loadMatches(sampleDate, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setFetching(false);
    }
  }

  const steps = result?.steps ?? [];
  const canGoPrev = (() => {
    const d = new Date(Date.UTC(calCursor.year, calCursor.monthIndex - 1, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const last = daysInMonth(y, m);
    const lastIso = `${y}-${String(m + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    return lastIso >= SAMPLE_DATE_MIN;
  })();
  const canGoNext = (() => {
    const d = new Date(Date.UTC(calCursor.year, calCursor.monthIndex + 1, 1));
    const firstIso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    return firstIso <= SAMPLE_DATE_MAX;
  })();

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
          <p className="page-sub" style={{ margin: "0 0 0.35rem" }}>
            <Link href="/live" style={{ textDecoration: "underline" }}>
              ← Live &amp; Fixtures
            </Link>
          </p>
          <h1 className="page-title">Live Refresh</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            Pick a day in the{" "}
            {sampleWindow.isFree ? "free-plan" : "paid-plan"} window (
            {SAMPLE_DATE_MIN} → {SAMPLE_DATE_MAX}
            {afPlan ? ` · AF ${afPlan}` : ""}). Matches load from the database
            first; API is used only when that day is empty (or you Force API
            fetch).
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
        <h2 style={{ margin: "0 0 0.5rem", fontSize: "0.9375rem" }}>
          Provider status
        </h2>
        <p style={{ margin: "0 0 0.35rem", fontSize: "0.875rem" }}>
          BeSoccer / Stats API:{" "}
          {besoccerStatus == null
            ? "checking…"
            : besoccerStatus.ok
              ? "connected"
              : besoccerStatus.configured
                ? `error — ${besoccerStatus.error ?? "failed"}`
                : "not configured (set STATS_API_KEY)"}
        </p>
        {besoccerStatus?.note && (
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
            {besoccerStatus.note}
          </p>
        )}
      </div>

      <div className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
        <h2 style={{ margin: "0 0 0.75rem", fontSize: "0.9375rem" }}>
          Sample day
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(16rem, 20rem) minmax(12rem, 1fr)",
            gap: "1rem",
            alignItems: "start",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "0.5rem",
                gap: "0.5rem",
              }}
            >
              <button
                type="button"
                className="btn"
                disabled={busy || !canGoPrev}
                onClick={() => shiftMonth(-1)}
                style={{ fontSize: "0.8125rem", border: "none", background: "var(--surface2)" }}
              >
                ‹
              </button>
              <strong style={{ fontSize: "0.875rem" }}>
                {monthLabel(calCursor.year, calCursor.monthIndex)}
              </strong>
              <button
                type="button"
                className="btn"
                disabled={busy || !canGoNext}
                onClick={() => shiftMonth(1)}
                style={{ fontSize: "0.8125rem", border: "none", background: "var(--surface2)" }}
              >
                ›
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: "0.25rem",
                fontSize: "0.6875rem",
                color: "var(--muted)",
                marginBottom: "0.25rem",
                textAlign: "center",
              }}
            >
              {WEEKDAYS.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: "0.25rem",
              }}
            >
              {calendarCells.map((cell, i) => {
                if (!cell.iso) {
                  return <span key={`b-${i}`} />;
                }
                const allowed = isSampleDateAllowed(cell.iso, sampleWindow);
                const selected = cell.iso === sampleDate;
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    disabled={busy || !allowed}
                    onClick={() => pickDate(cell.iso!)}
                    style={{
                      aspectRatio: "1",
                      border: selected
                        ? "1px solid var(--accent)"
                        : "1px solid transparent",
                      borderRadius: "6px",
                      background: selected
                        ? "var(--accent)"
                        : allowed
                          ? "var(--surface2)"
                          : "transparent",
                      color: selected
                        ? "#fff"
                        : allowed
                          ? "var(--text)"
                          : "var(--muted)",
                      opacity: allowed ? 1 : 0.35,
                      fontSize: "0.8125rem",
                      cursor: allowed && !busy ? "pointer" : "default",
                    }}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label
              htmlFor="sample-date"
              style={{ display: "block", fontSize: "0.8125rem", marginBottom: "0.35rem" }}
            >
              Date (UTC)
            </label>
            <input
              id="sample-date"
              type="date"
              min={SAMPLE_DATE_MIN}
              max={SAMPLE_DATE_MAX}
              value={sampleDate}
              disabled={busy}
              onChange={(e) => onDateInput(e.target.value)}
              style={{
                width: "100%",
                maxWidth: "16rem",
                padding: "0.5rem 0.65rem",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: "var(--surface2)",
                color: "var(--text)",
                fontSize: "0.875rem",
                marginBottom: "0.75rem",
              }}
            />
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", color: "var(--muted)" }}>
              Picking a date loads from the database first. API is used only when
              that day has no local fixtures. Outside {SAMPLE_DATE_MIN}–{SAMPLE_DATE_MAX}{" "}
              is blocked.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              <button
                type="button"
                className="btn"
                disabled={busy || !dateValid}
                onClick={() => void loadMatches(sampleDate, true)}
                style={{
                  background: "var(--surface2)",
                  color: "var(--text)",
                  border: "none",
                }}
              >
                {previewing ? "Loading…" : "Force API fetch"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  busy || !dateValid || !preview?.ok || !preview.matches.length
                }
                onClick={() => void fetchMatchData()}
              >
                {fetching ? "Fetching stats…" : "Fetch match stats"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {preview && (
        <div className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
          <h2 style={{ margin: "0 0 0.5rem", fontSize: "0.9375rem" }}>
            Available matches · {preview.date}{" "}
            <span style={{ color: "var(--muted)", fontWeight: 500 }}>
              (season {preview.season}, {preview.matchCount}
              {preview.source ? ` · ${preview.source}` : ""}
              {preview.withMatchStatsCount != null
                ? ` · ${preview.withMatchStatsCount} with stats`
                : ""}
              )
            </span>
          </h2>
          {previewing && (
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", color: "var(--muted)" }}>
              Checking database…
            </p>
          )}
          {preview.warning && (
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", color: "var(--muted)" }}>
              {preview.warning}
            </p>
          )}
          {preview.matches.length === 0 ? (
            <p style={{ margin: 0, color: "var(--muted)" }}>
              No fixtures for this day. Try Force API fetch or pick another date.
            </p>
          ) : (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {preview.matches.map((m) => (
                <PreviewRow
                  key={m.fixtureId}
                  match={m}
                  disabled={busy || statsLoading}
                  onViewStats={() => void openMatchStats(m, false)}
                />
              ))}
            </div>
          )}
          {preview.matches.length > 0 && !result && (
            <p style={{ margin: "0.75rem 0 0", fontSize: "0.8125rem", color: "var(--muted)" }}>
              View stats reads match_stats from the DB when present. Force API fetch
              refreshes the day list from providers.
            </p>
          )}
        </div>
      )}

      {statsDialogMatch && (
        <MatchStatsDialog
          match={statsDialogMatch}
          loading={statsLoading}
          error={statsError}
          payload={statsPayload}
          onClose={closeMatchStats}
          onForceRefresh={() => void openMatchStats(statsDialogMatch, true)}
        />
      )}

      {result && (
        <>
          <div className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
            <h2 style={{ margin: "0 0 0.5rem", fontSize: "0.9375rem" }}>
              Status
            </h2>
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.875rem" }}>
              {result.ok
                ? result.skippedRun
                  ? "Completed — nothing to refresh"
                  : "Completed"
                : "Failed"}
              {result.sampleDate ? ` · ${result.sampleDate}` : ""}
              {result.warning ? ` · ${result.warning}` : ""}
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(8rem, 1fr))",
                gap: "0.5rem",
                fontSize: "0.8125rem",
              }}
            >
              <Stat label="AF fetched" value={result.apiFootballFetched} />
              <Stat label="Listed (day)" value={result.discoverCount ?? 0} />
              <Stat label="Stats mapped" value={result.beSoccerMapped} />
              <Stat label="Stats fetched" value={result.beSoccerFetched} />
              <Stat label="Conflicts" value={result.conflictCount} />
              <Stat label="Upserted" value={result.upserted} />
              <Stat label="DB rows" value={result.dbConfirmedRows ?? 0} />
              <Stat label="DB w/ stats" value={result.dbConfirmedStats ?? 0} />
            </div>
          </div>

          <div className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
            <h2 style={{ margin: "0 0 0.75rem", fontSize: "0.9375rem" }}>
              Steps
            </h2>
            <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "0.5rem" }}>
              {steps.map((s, i) => (
                <li
                  key={s.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.5rem 1fr",
                    gap: "0.5rem",
                    fontSize: "0.875rem",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: "0.65rem",
                      height: "0.65rem",
                      borderRadius: "999px",
                      background: stepColor(s.status),
                      marginTop: "0.35rem",
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {i + 1}. {s.label}{" "}
                      <span style={{ color: "var(--muted)", fontWeight: 500 }}>
                        ({s.status})
                      </span>
                    </div>
                    {s.detail && (
                      <div style={{ color: "var(--muted)", fontSize: "0.8125rem" }}>
                        {s.detail}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="card" style={{ padding: "1rem" }}>
            <h2 style={{ margin: "0 0 0.75rem", fontSize: "0.9375rem" }}>
              Fetched results ({result.fixtures.length})
            </h2>
            {result.fixtures.length === 0 ? (
              <p style={{ margin: 0, color: "var(--muted)" }}>No fixtures returned.</p>
            ) : (
              <div style={{ display: "grid", gap: "0.65rem" }}>
                {result.fixtures.map((f) => (
                  <div
                    key={f.fixtureId}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      padding: "0.75rem",
                      background: "var(--surface2)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "0.35rem 0.75rem",
                        fontSize: "0.75rem",
                        color: "var(--muted)",
                        marginBottom: "0.35rem",
                      }}
                    >
                      <span>#{f.fixtureId}</span>
                      <span>{f.status}</span>
                      {f.besoccerMatchId != null && (
                        <span>Stats API {f.besoccerMatchId}</span>
                      )}
                      {!!f.sourceConflicts.length && (
                        <span style={{ color: "var(--warn)", fontWeight: 600 }}>
                          mismatch
                        </span>
                      )}
                    </div>
                    <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
                      {f.homeTeam} {score(f)} {f.awayTeam}
                    </div>
                    {(f.homeCorners != null ||
                      f.awayCorners != null ||
                      f.homeShots != null ||
                      f.homePossession != null) && (
                      <div style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
                        {f.homeCorners != null || f.awayCorners != null
                          ? `Corners ${f.homeCorners ?? "—"}–${f.awayCorners ?? "—"} `
                          : ""}
                        {f.homeShots != null || f.awayShots != null
                          ? `· Shots ${f.homeShots ?? "—"}–${f.awayShots ?? "—"} `
                          : ""}
                        {f.homePossession != null || f.awayPossession != null
                          ? `· Poss ${f.homePossession ?? "—"}–${f.awayPossession ?? "—"}%`
                          : ""}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PreviewRow({
  match,
  disabled,
  onViewStats,
}: {
  match: SampleDayMatch;
  disabled?: boolean;
  onViewStats: () => void;
}) {
  const kick = match.kickoffUtc
    ? new Date(match.kickoffUtc).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      })
    : "—";
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "8px",
        padding: "0.65rem 0.75rem",
        background: "var(--surface2)",
        fontSize: "0.875rem",
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: "0.75rem",
        alignItems: "center",
      }}
    >
      <div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.35rem 0.75rem",
            fontSize: "0.75rem",
            color: "var(--muted)",
            marginBottom: "0.25rem",
          }}
        >
          <span>{match.leagueName}</span>
          <span>{kick} UTC</span>
          <span>{match.status}</span>
          <span>#{match.fixtureId}</span>
          {match.hasMatchStats && (
            <span style={{ color: "var(--accent2, #16a34a)", fontWeight: 600 }}>
              stats cached
            </span>
          )}
        </div>
        <div style={{ fontWeight: 600 }}>
          {match.homeTeam} {scoreLine(match.homeGoals, match.awayGoals)}{" "}
          {match.awayTeam}
        </div>
        {match.hasMatchStats &&
          (match.homeCorners != null || match.homeShots != null) && (
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.2rem" }}>
              {match.homeCorners != null || match.awayCorners != null
                ? `Corners ${match.homeCorners ?? "—"}–${match.awayCorners ?? "—"} `
                : ""}
              {match.homeShots != null || match.awayShots != null
                ? `· Shots ${match.homeShots ?? "—"}–${match.awayShots ?? "—"}`
                : ""}
            </div>
          )}
      </div>
      <button
        type="button"
        className="btn"
        disabled={disabled}
        onClick={onViewStats}
        style={{
          fontSize: "0.75rem",
          whiteSpace: "nowrap",
          background: "var(--surface)",
          color: "var(--text)",
          border: "1px solid var(--border)",
        }}
      >
        View stats
      </button>
    </div>
  );
}

function MatchStatsDialog({
  match,
  loading,
  error,
  payload,
  onClose,
  onForceRefresh,
}: {
  match: SampleDayMatch;
  loading: boolean;
  error: string | null;
  payload: MatchStatsResponse | null;
  onClose: () => void;
  onForceRefresh: () => void;
}) {
  const fx = payload?.fixture;
  const fromApi = payload?.source === "api";
  const showRaw = fromApi && !!payload?.rawJson;

  const teamRows = useMemo(() => {
    if (!fx) return [] as Array<{ label: string; home: string; away: string }>;
    const fmt = (n: number | null | undefined, decimals?: number) => {
      if (n == null) return "—";
      if (decimals != null) return n.toFixed(decimals);
      return String(n);
    };
    return [
      { label: "Goals", home: fmt(fx.homeGoals), away: fmt(fx.awayGoals) },
      { label: "xG", home: fmt(fx.homeXg, 2), away: fmt(fx.awayXg, 2) },
      {
        label: "Possession %",
        home: fmt(fx.homePossession),
        away: fmt(fx.awayPossession),
      },
      { label: "Shots", home: fmt(fx.homeShots), away: fmt(fx.awayShots) },
      {
        label: "On target",
        home: fmt(fx.homeShotsOnTarget),
        away: fmt(fx.awayShotsOnTarget),
      },
      {
        label: "Big chances",
        home: fmt(fx.homeBigChances),
        away: fmt(fx.awayBigChances),
      },
      { label: "Corners", home: fmt(fx.homeCorners), away: fmt(fx.awayCorners) },
      { label: "Fouls", home: fmt(fx.homeFouls), away: fmt(fx.awayFouls) },
      {
        label: "Free kicks",
        home: fmt(fx.homeFreeKicks),
        away: fmt(fx.awayFreeKicks),
      },
      {
        label: "Yellow cards",
        home: fmt(fx.homeYellowCards),
        away: fmt(fx.awayYellowCards),
      },
      {
        label: "Red cards",
        home: fmt(fx.homeRedCards),
        away: fmt(fx.awayRedCards),
      },
      { label: "GK saves", home: fmt(fx.homeGkSaves), away: fmt(fx.awayGkSaves) },
      { label: "Passes", home: fmt(fx.homePasses), away: fmt(fx.awayPasses) },
      {
        label: "Accurate passes",
        home: fmt(fx.homeAccuratePasses),
        away: fmt(fx.awayAccuratePasses),
      },
      { label: "Tackles", home: fmt(fx.homeTackles), away: fmt(fx.awayTackles) },
    ];
  }, [fx]);

  const prettyRaw = useMemo(() => {
    if (!payload?.rawJson) return null;
    try {
      return JSON.stringify(JSON.parse(payload.rawJson), null, 2);
    } catch {
      return payload.rawJson;
    }
  }, [payload?.rawJson]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Match stats"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 80,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: showRaw ? "56rem" : "32rem",
          maxHeight: "85dvh",
          overflow: "auto",
          padding: "1rem",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "0.5rem",
            marginBottom: "0.75rem",
            alignItems: "flex-start",
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>
              Match stats
            </h2>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
              #{match.fixtureId} · {match.leagueName}
              {payload?.source ? ` · ${payload.source}` : ""}
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.35rem" }}>
            <button
              type="button"
              className="btn"
              disabled={loading}
              onClick={onForceRefresh}
              style={{
                fontSize: "0.75rem",
                background: "var(--surface2)",
                border: "none",
              }}
            >
              Force refresh
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <p style={{ margin: "0 0 0.75rem", fontWeight: 600 }}>
          {match.homeTeam} {scoreLine(match.homeGoals, match.awayGoals)}{" "}
          {match.awayTeam}
        </p>

        {loading && (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.875rem" }}>
            {payload?.source === "database"
              ? "Loading…"
              : "Checking match_stats / fetching Stats API…"}
          </p>
        )}

        {error && (
          <div className="alert alert-error" style={{ marginBottom: "0.75rem" }}>
            {error}
          </div>
        )}

        {!loading && fx && (
          <>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", color: "var(--muted)" }}>
              {payload?.source === "database"
                ? `From match_stats · synced ${new Date(fx.lastSyncedUtc).toLocaleString()}`
                : payload?.persistedToMatchStats
                  ? `Fetched from API · persisted to match_stats · synced ${new Date(fx.lastSyncedUtc).toLocaleString()}`
                  : payload?.persisted
                    ? `Fetched from API · synced ${new Date(fx.lastSyncedUtc).toLocaleString()}`
                    : "Not confirmed in DB"}
              {fx.besoccerMatchId ? ` · ${fx.besoccerMatchId}` : ""}
              {fx.status ? ` · ${fx.status}` : ""}
            </p>
            {payload?.warning && (
              <p style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", color: "var(--warn)" }}>
                {payload.warning}
              </p>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: showRaw ? "minmax(0, 1fr) minmax(0, 1fr)" : "1fr",
                gap: "1rem",
                alignItems: "start",
              }}
            >
              <div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1fr 1fr",
                    gap: "0.35rem 0.5rem",
                    fontSize: "0.8125rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  <div style={{ color: "var(--muted)", fontSize: "0.6875rem" }}>
                    Stat
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: "0.75rem",
                      textAlign: "right",
                    }}
                  >
                    {fx.homeTeam}
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: "0.75rem",
                      textAlign: "right",
                    }}
                  >
                    {fx.awayTeam}
                  </div>
                  {teamRows.map((row) => (
                    <div
                      key={row.label}
                      style={{ display: "contents" }}
                    >
                      <div
                        style={{
                          color: "var(--muted)",
                          padding: "0.35rem 0",
                          borderTop: "1px solid var(--border)",
                        }}
                      >
                        {row.label}
                      </div>
                      <div
                        style={{
                          textAlign: "right",
                          fontWeight: 600,
                          fontVariantNumeric: "tabular-nums",
                          padding: "0.35rem 0",
                          borderTop: "1px solid var(--border)",
                        }}
                      >
                        {row.home}
                      </div>
                      <div
                        style={{
                          textAlign: "right",
                          fontWeight: 600,
                          fontVariantNumeric: "tabular-nums",
                          padding: "0.35rem 0",
                          borderTop: "1px solid var(--border)",
                        }}
                      >
                        {row.away}
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ margin: "0.5rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                  Kickoff{" "}
                  {new Date(fx.kickoffUtc).toLocaleString("en-GB", {
                    timeZone: "UTC",
                  })}{" "}
                  UTC
                </p>
              </div>

              {showRaw && prettyRaw && (
                <div>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      marginBottom: "0.35rem",
                    }}
                  >
                    Raw API JSON
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: "0.75rem",
                      borderRadius: "8px",
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      fontSize: "0.6875rem",
                      lineHeight: 1.4,
                      overflow: "auto",
                      maxHeight: "55dvh",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {prettyRaw}
                  </pre>
                </div>
              )}
            </div>

            {!!fx.sourceConflicts?.length && (
              <div
                style={{
                  marginTop: "0.75rem",
                  fontSize: "0.75rem",
                  color: "var(--warn)",
                }}
              >
                {fx.sourceConflicts
                  .map(
                    (c) =>
                      `${c.field}: AF ${String(c.apiFootball)} vs Stats ${String(c.beSoccer)}`
                  )
                  .join(" · ")}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        background: "var(--surface2)",
        borderRadius: "8px",
        padding: "0.5rem 0.65rem",
      }}
    >
      <div style={{ color: "var(--muted)", fontSize: "0.6875rem" }}>{label}</div>
      <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
    </div>
  );
}
