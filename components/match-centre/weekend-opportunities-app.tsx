"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { confidenceTone } from "@/lib/prediction-log/decision-maker/confidence";
import type { WeekendOpportunityRow } from "@/lib/match-centre/weekend-opportunities";

type WeekendApiResponse = {
  ok?: boolean;
  error?: string;
  generatedAt?: string;
  window?: { from: string; to: string };
  fixturePoolCount?: number;
  selectedCount?: number;
  insufficientPool?: boolean;
  rows?: WeekendOpportunityRow[];
  warnings?: string[];
  filteredCount?: number;
};

function toneStyle(confidence: number): React.CSSProperties {
  const tone = confidenceTone(confidence);
  switch (tone) {
    case "green":
      return { background: "rgba(34, 197, 94, 0.18)", color: "#15803d" };
    case "yellow":
      return { background: "rgba(234, 179, 8, 0.2)", color: "#a16207" };
    case "orange":
      return { background: "rgba(249, 115, 22, 0.18)", color: "#c2410c" };
    default:
      return { background: "var(--surface2)", color: "var(--muted)" };
  }
}

function formatKickoff(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

function TracePanel({ row }: { row: WeekendOpportunityRow }) {
  const p = row.trace.cfeProvenance;
  return (
    <div
      style={{
        marginTop: "0.5rem",
        padding: "0.75rem",
        background: "var(--surface2)",
        borderRadius: 8,
        fontSize: "0.8rem",
        lineHeight: 1.5,
      }}
    >
      <div>
        <strong>Fixture API id:</strong> {row.apiFixtureId}
      </div>
      <div>
        <strong>Source:</strong> {row.trace.fixtureSource}
      </div>
      <div>
        <strong>Best market family:</strong> {row.trace.family} ·{" "}
        {row.trace.selectionKey}
      </div>
      <div>
        <strong>Raw p:</strong> {(row.trace.pRaw * 100).toFixed(1)}% ·{" "}
        <strong>Calibrated p:</strong> {(row.trace.pCalibrated * 100).toFixed(1)}
        % · n={row.trace.nEffective}
      </div>
      <div>
        <strong>CFE blend:</strong> API {p.api_pct}% · Manual/AI {p.manual_pct}%
        {p.apiSeasonBlend ? ` · season ${p.apiSeasonBlend}` : ""}
      </div>
      <div>
        <strong>Matches used:</strong> {p.matches_used} · ESS {p.ess}
      </div>
      <div>
        <strong>Coherence:</strong>{" "}
        {row.trace.coherenceOk ? "ok" : "check grid"}
      </div>
    </div>
  );
}

export function WeekendOpportunitiesApp() {
  const [data, setData] = useState<WeekendApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const load = useCallback(async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const q = refresh ? "?refresh=1" : "";
      const res = await fetch(`/api/match-centre/weekend-opportunities${q}`);
      const json = (await res.json()) as WeekendApiResponse;
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not load weekend picks");
        setData(null);
        return;
      }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load weekend picks");
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const rows = data?.rows ?? [];

  return (
    <main style={{ maxWidth: "72rem", margin: "0 auto" }}>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "1rem",
          marginBottom: "1.25rem",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "1.35rem" }}>Weekend Picks</h1>
          <p className="page-sub" style={{ marginTop: "0.35rem", maxWidth: "42rem" }}>
            Upcoming Sat–Sun fixtures from Match Centre (next 7 days, all five
            leagues). Each row is the single highest-probability market from the
            full CFE scan — top 10–20 matches ranked globally. Combo picks:
            Double Chance + BTTS, BTTS + Total, Win + Total only.
          </p>
          {data && (
            <p className="page-sub" style={{ marginTop: "0.25rem" }}>
              Scanned {data.fixturePoolCount ?? 0} weekend fixtures · showing{" "}
              {data.selectedCount ?? 0} picks
              {data.generatedAt
                ? ` · updated ${new Date(data.generatedAt).toLocaleTimeString()}`
                : ""}
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn"
          disabled={loading || refreshing}
          onClick={() => void load(true)}
        >
          {refreshing ? "Refreshing…" : "Refresh from API"}
        </button>
      </header>

      {loading && !data && (
        <p className="page-sub">Loading weekend opportunities…</p>
      )}

      {error && (
        <p style={{ color: "var(--danger, #b91c1c)", marginBottom: "1rem" }}>
          {error}
        </p>
      )}

      {data?.warnings?.map((w) => (
        <p
          key={w}
          style={{
            padding: "0.65rem 0.85rem",
            marginBottom: "0.75rem",
            background: "rgba(234, 179, 8, 0.15)",
            borderRadius: 8,
            fontSize: "0.9rem",
          }}
        >
          {w}
        </p>
      ))}

      {(data?.filteredCount ?? 0) > 0 && (
        <p
          style={{
            padding: "0.65rem 0.85rem",
            marginBottom: "0.75rem",
            background: "rgba(234, 179, 8, 0.12)",
            borderRadius: 8,
            fontSize: "0.9rem",
          }}
        >
          {data!.filteredCount} non-league / out-of-roster fixtures hidden (men&apos;s
          top flight only).
        </p>
      )}

      {!loading && rows.length === 0 && !error && (
        <div
          style={{
            padding: "1.5rem",
            background: "var(--surface2)",
            borderRadius: 8,
          }}
        >
          <p style={{ margin: 0 }}>
            No weekend fixtures in the next 7 days. Check the{" "}
            <Link href="/match-centre?tab=next-match">Next Match</Link> tab for
            the full upcoming schedule.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.9rem",
            }}
          >
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                <th style={{ padding: "0.5rem" }}>#</th>
                <th style={{ padding: "0.5rem" }}>Match</th>
                <th style={{ padding: "0.5rem" }}>League</th>
                <th style={{ padding: "0.5rem" }}>Kickoff (UTC)</th>
                <th style={{ padding: "0.5rem" }}>Best market</th>
                <th style={{ padding: "0.5rem" }}>Prediction</th>
                <th style={{ padding: "0.5rem" }}>Prob</th>
                <th style={{ padding: "0.5rem" }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.apiFixtureId}>
                  <tr
                    style={{ borderBottom: "1px solid var(--border)" }}
                  >
                    <td style={{ padding: "0.5rem", fontWeight: 700 }}>
                      {row.rank}
                    </td>
                    <td style={{ padding: "0.5rem", fontWeight: 600 }}>
                      {row.matchLabel}
                    </td>
                    <td style={{ padding: "0.5rem" }}>{row.league}</td>
                    <td style={{ padding: "0.5rem", whiteSpace: "nowrap" }}>
                      {formatKickoff(row.kickoffIso)}
                    </td>
                    <td style={{ padding: "0.5rem" }}>{row.marketLabel}</td>
                    <td style={{ padding: "0.5rem" }}>{row.prediction}</td>
                    <td style={{ padding: "0.5rem" }}>
                      <span
                        style={{
                          ...toneStyle(row.probabilityPct),
                          padding: "0.15rem 0.45rem",
                          borderRadius: 6,
                          fontWeight: 700,
                        }}
                      >
                        {row.probabilityPct}%
                      </span>
                    </td>
                    <td style={{ padding: "0.5rem" }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          setExpanded((prev) => ({
                            ...prev,
                            [row.apiFixtureId]: !prev[row.apiFixtureId],
                          }))
                        }
                      >
                        {expanded[row.apiFixtureId] ? "Hide" : "Trace"}
                      </button>
                    </td>
                  </tr>
                  {expanded[row.apiFixtureId] && (
                    <tr>
                      <td colSpan={8} style={{ padding: "0 0.5rem 0.75rem" }}>
                        <TracePanel row={row} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
