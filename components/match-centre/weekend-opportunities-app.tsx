"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { confidenceTone } from "@/lib/prediction-log/decision-maker/confidence";
import type { WeekendOpportunityRow } from "@/lib/match-centre/weekend-opportunities";
import type {
  PortfolioCategoryId,
  PortfolioPick,
  WeekendPortfolioResult,
} from "@/lib/match-centre/weekend-portfolio";
import { PORTFOLIO_TARGET_TOTAL } from "@/lib/match-centre/weekend-portfolio";
import type { WeekendLearnerSyncResult } from "@/lib/prediction-log/weekend-analysis-learner";

type WeekendApiResponse = {
  ok?: boolean;
  error?: string;
  generatedAt?: string;
  window?: { from: string; to: string };
  fixturePoolCount?: number;
  selectedCount?: number;
  insufficientPool?: boolean;
  rows?: WeekendOpportunityRow[];
  portfolio?: WeekendPortfolioResult;
  warnings?: string[];
  filteredCount?: number;
  learnerSync?: WeekendLearnerSyncResult | null;
  weekendBatchId?: string;
};

function toneStyle(confidence: number | null): React.CSSProperties {
  if (confidence == null) {
    return { background: "var(--surface2)", color: "var(--muted)" };
  }
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
      {row.trace.noEstimate ? (
        <div>
          <strong>Estimate:</strong> unavailable for this fixture
        </div>
      ) : (
        <>
          <div>
            <strong>Best market family:</strong> {row.trace.family} ·{" "}
            {row.trace.selectionKey}
          </div>
          <div>
            <strong>Raw p:</strong> {(row.trace.pRaw * 100).toFixed(1)}% ·{" "}
            <strong>Calibrated p:</strong>{" "}
            {(row.trace.pCalibrated * 100).toFixed(1)}% · n={row.trace.nEffective}
          </div>
          {p && (
            <>
              <div>
                <strong>CFE blend:</strong>{" "}
                {p.recent_pct != null && p.prior_pct != null ? (
                  <>
                    Last 5 {p.recent_pct.toFixed(0)}% · Prior API{" "}
                    {p.prior_pct.toFixed(0)}% · System {p.manual_pct}%
                  </>
                ) : (
                  <>
                    API {p.api_pct}% · System season {p.manual_pct}%
                  </>
                )}
                {p.apiSeasonBlend ? ` · season ${p.apiSeasonBlend}` : ""}
              </div>
              <div>
                <strong>Matches used:</strong> {p.matches_used} · ESS {p.ess}
              </div>
            </>
          )}
          <div>
            <strong>Coherence:</strong>{" "}
            {row.trace.coherenceOk ? "ok" : "check grid"}
          </div>
          <div>
            <strong>MSAM gate:</strong>{" "}
            {row.trace.msamGatePassed ? "passed" : "fallback (low evidence)"}
            {row.trace.ineligibilityReasons?.length
              ? ` · ${row.trace.ineligibilityReasons.join(", ")}`
              : ""}
          </div>
          {row.trace.marketMargin != null && (
            <div>
              <strong>Market margin:</strong>{" "}
              {(row.trace.marketMargin * 100).toFixed(1)} pp
              {row.trace.secondBestPCalibrated != null
                ? ` (2nd best ${(row.trace.secondBestPCalibrated * 100).toFixed(1)}%)`
                : ""}
              {row.trace.marginOk != null && (
                <>
                  {" "}
                  · margin gate {row.trace.marginOk ? "ok" : "below 5 pp"} (info
                  only)
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PortfolioSection({ portfolio }: { portfolio: WeekendPortfolioResult }) {
  const picksByCategory = new Map<PortfolioCategoryId, PortfolioPick[]>();
  for (const pick of portfolio.picks) {
    const list = picksByCategory.get(pick.category) ?? [];
    list.push(pick);
    picksByCategory.set(pick.category, list);
  }

  const reducedLabels = portfolio.categories
    .filter((c) => c.reduced)
    .map((c) => c.label);

  const copyText = portfolio.picks
    .map(
      (p) =>
        `${p.matchLabel} · ${p.prediction} (${Math.round(p.pCalibrated * 1000) / 10}%)`
    )
    .join("\n");

  return (
    <section style={{ marginTop: "2.5rem" }}>
      <header style={{ marginBottom: "1rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.15rem" }}>
          Weekend Portfolio ({PORTFOLIO_TARGET_TOTAL})
        </h2>
        <p className="page-sub" style={{ marginTop: "0.35rem", maxWidth: "48rem" }}>
          {portfolio.picks.length} unique matches across specialist markets — ranked by
          collaborative score (50% existing system + 50% independent MSAM advisory).
          Canonical probability shown separately; three weakest categories auto-trimmed
          from 3 to 2 picks.
          {reducedLabels.length > 0 && (
            <>
              {" "}
              Trimmed: {reducedLabels.join(", ")}.
            </>
          )}
        </p>
        {portfolio.warnings.length > 0 && (
          <div style={{ marginTop: "0.5rem" }}>
            {portfolio.warnings.map((w) => (
              <p
                key={w}
                style={{
                  padding: "0.5rem 0.75rem",
                  marginBottom: "0.35rem",
                  background: "rgba(234, 179, 8, 0.12)",
                  borderRadius: 8,
                  fontSize: "0.85rem",
                }}
              >
                {w}
              </p>
            ))}
          </div>
        )}
        <button
          type="button"
          className="btn btn-sm"
          style={{ marginTop: "0.5rem" }}
          onClick={() => void navigator.clipboard.writeText(copyText)}
        >
          Copy all picks
        </button>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        {portfolio.categories.map((cat) => {
          const picks = picksByCategory.get(cat.id) ?? [];
          if (picks.length === 0) return null;
          return (
            <div
              key={cat.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "0.65rem 0.85rem",
                  background: "var(--surface2)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  flexWrap: "wrap",
                }}
              >
                <strong>{cat.label}</strong>
                <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                  {picks.length}/{cat.quota} picks
                </span>
                {cat.reduced && (
                  <span
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      padding: "0.1rem 0.4rem",
                      borderRadius: 4,
                      background: "rgba(234, 179, 8, 0.2)",
                      color: "#a16207",
                    }}
                  >
                    trimmed to 2
                  </span>
                )}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "0.88rem",
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        textAlign: "left",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <th style={{ padding: "0.45rem 0.65rem" }}>#</th>
                      <th style={{ padding: "0.45rem 0.65rem" }}>Match</th>
                      <th style={{ padding: "0.45rem 0.65rem" }}>League</th>
                      <th style={{ padding: "0.45rem 0.65rem" }}>Kickoff</th>
                      <th style={{ padding: "0.45rem 0.65rem" }}>Pick</th>
                      <th style={{ padding: "0.45rem 0.65rem" }} title="Existing system (CFE)">
                        Existing
                      </th>
                      <th style={{ padding: "0.45rem 0.65rem" }} title="Independent MSAM">
                        MSAM
                      </th>
                      <th style={{ padding: "0.45rem 0.65rem" }} title="Collaborative ranking score">
                        Collab
                      </th>
                      <th style={{ padding: "0.45rem 0.65rem" }}>Agreement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {picks.map((pick) => (
                      <tr
                        key={`${cat.id}-${pick.apiFixtureId}`}
                        style={{ borderBottom: "1px solid var(--border)" }}
                      >
                        <td style={{ padding: "0.45rem 0.65rem", fontWeight: 700 }}>
                          {pick.rankInCategory}
                        </td>
                        <td style={{ padding: "0.45rem 0.65rem", fontWeight: 600 }}>
                          {pick.matchLabel}
                        </td>
                        <td style={{ padding: "0.45rem 0.65rem" }}>{pick.league}</td>
                        <td
                          style={{
                            padding: "0.45rem 0.65rem",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {formatKickoff(pick.kickoffIso)}
                        </td>
                        <td style={{ padding: "0.45rem 0.65rem" }}>
                          {pick.prediction}
                        </td>
                        <td style={{ padding: "0.45rem 0.65rem" }}>
                          <span
                            style={{
                              ...toneStyle(
                                Math.round(pick.pCalibrated * 1000) / 10
                              ),
                              padding: "0.12rem 0.4rem",
                              borderRadius: 6,
                              fontWeight: 700,
                            }}
                            title="Existing system selection"
                          >
                            {Math.round(pick.pCalibrated * 1000) / 10}%
                          </span>
                        </td>
                        <td style={{ padding: "0.45rem 0.65rem" }}>
                          {pick.trace.msamNormalizedScore != null
                            ? `${Math.round(pick.trace.msamNormalizedScore)}`
                            : "—"}
                        </td>
                        <td style={{ padding: "0.45rem 0.65rem" }}>
                          {pick.trace.finalAdvisoryScore != null ? (
                            <span
                              style={{
                                fontWeight: 700,
                                color: "var(--foreground)",
                              }}
                            >
                              {Math.round(pick.trace.finalAdvisoryScore)}
                            </span>
                          ) : (
                            <span style={{ color: "var(--muted)" }}>Review</span>
                          )}
                        </td>
                        <td style={{ padding: "0.45rem 0.65rem", fontSize: "0.78rem" }}>
                          {pick.trace.agreementStatus ?? "—"}
                          {pick.trace.advisoryStatus === "Insufficient Data" && (
                            <span style={{ display: "block", color: "var(--muted)" }}>
                              Insufficient data
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function WeekendOpportunitiesApp() {
  const [data, setData] = useState<WeekendApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingResults, setSyncingResults] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const weekendBatchId = data?.weekendBatchId ?? null;

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

  async function syncResultsNow() {
    if (!weekendBatchId) return;
    setSyncingResults(true);
    setSyncMsg("Syncing match results from API…");
    let remaining: string[] = [];
    let rounds = 0;
    try {
      do {
        rounds++;
        const res = await fetch("/api/sync-results", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchId: weekendBatchId, batchFill: true }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          unavailable?: boolean;
          filled?: number;
          enriched?: number;
          remaining?: string[];
        };
        if (!res.ok || json.unavailable) {
          throw new Error(json.error ?? "Result sync unavailable");
        }
        remaining = json.remaining ?? [];
      } while (remaining.length > 0 && rounds < 15);

      setSyncMsg(
        remaining.length > 0
          ? `${remaining.length} fixture(s) still pending after sync`
          : "All saved weekend fixtures synced"
      );
      await load(true);
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Result sync failed");
    } finally {
      setSyncingResults(false);
      setTimeout(() => setSyncMsg(null), 8000);
    }
  }

  const rows = data?.rows ?? [];
  const learnerSync = data?.learnerSync;

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
            All fixtures from Match Centre in the next 7 days (Mon–Sun, five leagues),
            ranked by best-market calibrated probability. Each match gets one
            pick — the highest-probability market across all families (including
            Draw Either Half, Corners, Handicap, Highest Scoring Half, Win One
            Half, Total Goals, and others). MSAM evidence quality is shown in
            trace and the Low evidence badge, not used to exclude a higher-probability
            pick. Total Goals: Over ≥2.5, Under ≤3.5. Team Goals: Over ≥0.5,
            Under ≤1.5 per side.
          </p>
          {data && (
            <p className="page-sub" style={{ marginTop: "0.25rem" }}>
              {data.selectedCount ?? 0} matches ranked
              {data.generatedAt
                ? ` · updated ${new Date(data.generatedAt).toLocaleTimeString()}`
                : ""}
            </p>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <button
            type="button"
            className="btn"
            disabled={loading || refreshing}
            onClick={() => void load(true)}
          >
            {refreshing ? "Refreshing…" : "Refresh from API"}
          </button>
          {weekendBatchId && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading || refreshing || syncingResults}
              onClick={() => void syncResultsNow()}
            >
              {syncingResults ? "Syncing results…" : "Sync results now"}
            </button>
          )}
        </div>
      </header>

      {learnerSync && (
        <div
          style={{
            padding: "0.65rem 0.85rem",
            marginBottom: "0.75rem",
            background: learnerSync.error
              ? "rgba(239, 68, 68, 0.12)"
              : "rgba(34, 197, 94, 0.12)",
            borderRadius: 8,
            fontSize: "0.9rem",
          }}
        >
          {learnerSync.error ? (
            <span>Save failed: {learnerSync.error}</span>
          ) : (
            <span>
              Saved {learnerSync.saved} batch(es) to database
              {learnerSync.pendingFill > 0
                ? ` · ${learnerSync.pendingFill} fixture(s) awaiting results`
                : " · all fixtures filled"}
              {learnerSync.scoredPicks > 0
                ? ` · ${learnerSync.scoredPicks} pick(s) graded for AI learner`
                : ""}
            </span>
          )}
        </div>
      )}

      {syncMsg && (
        <p className="page-sub" style={{ marginBottom: "0.75rem" }}>
          {syncMsg}
        </p>
      )}

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
            No upcoming fixtures in the next 7 days. Check the{" "}
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
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.5rem", fontWeight: 700 }}>
                      {row.rank}
                    </td>
                    <td style={{ padding: "0.5rem", fontWeight: 600 }}>
                      {row.matchLabel}
                      {!row.msamGatePassed && row.probabilityPct != null && (
                        <span
                          style={{
                            marginLeft: "0.35rem",
                            fontSize: "0.7rem",
                            fontWeight: 600,
                            color: "var(--muted)",
                          }}
                        >
                          Low evidence
                        </span>
                      )}
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
                        {row.probabilityPct != null ? `${row.probabilityPct}%` : "—"}
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

      {data?.portfolio && data.portfolio.picks.length > 0 && (
        <PortfolioSection portfolio={data.portfolio} />
      )}
    </main>
  );
}
