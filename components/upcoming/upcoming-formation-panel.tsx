"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { usePredictionLogData } from "@/components/prediction-log/use-prediction-log-data";
import type { FormationReference } from "@/lib/upcoming/formation-reference";
import { leagueShortLabel } from "@/lib/prediction-log/match-league";
import { OpenInDmButton } from "./open-in-dm-button";
import { UpcomingFixturesHeader } from "./upcoming-fixtures-header";
import { useUpcomingPredictions } from "./upcoming-predictions-context";
import { useUpcomingFormationReferences } from "./use-upcoming-formation-references";

function stabilityStyle(label: "stable" | "mixed" | "unknown"): CSSProperties {
  switch (label) {
    case "stable":
      return { background: "rgba(34, 197, 94, 0.16)", color: "#166534" };
    case "mixed":
      return { background: "rgba(245, 158, 11, 0.18)", color: "#b45309" };
    default:
      return { background: "var(--surface2)", color: "var(--muted)" };
  }
}

function sourceLabel(source: FormationReference["source"]): string {
  switch (source) {
    case "api":
      return "API announced";
    case "mixed":
      return "API + history";
    case "history":
      return "History trace";
    default:
      return "Awaiting data";
  }
}

function formatKickoff(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SideFormationBlock({
  side,
  align,
}: {
  side: FormationReference["home"];
  align: "left" | "right";
}) {
  return (
    <div style={{ flex: 1, minWidth: 0, textAlign: align === "right" ? "right" : "left" }}>
      <div style={{ fontWeight: 700, fontSize: "0.875rem", marginBottom: "0.35rem" }}>
        {side.team}
      </div>
      <div style={{ fontSize: "0.8125rem", marginBottom: "0.25rem" }}>
        Announced:{" "}
        <strong>{side.announced ?? "—"}</strong>
        {side.announcedXi?.length ? (
          <span style={{ color: "var(--muted)", fontWeight: 400 }}>
            {" "}
            · XI ({side.announcedXi.length})
          </span>
        ) : null}
      </div>
      <div style={{ fontSize: "0.8125rem", marginBottom: "0.35rem" }}>
        Typical (recent): <strong>{side.typical ?? "—"}</strong>
      </div>
      <span
        className="badge"
        style={{
          ...stabilityStyle(side.stabilityLabel),
          fontSize: "0.7rem",
          fontWeight: 700,
        }}
      >
        {side.stabilityLabel}
      </span>
      {side.recent.length > 0 ? (
        <ul
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: align === "right" ? 0 : "1.1rem",
            paddingRight: align === "right" ? "1.1rem" : 0,
            listStyle: align === "right" ? "none" : "disc",
            fontSize: "0.75rem",
            color: "var(--muted)",
          }}
        >
          {side.recent.slice(0, 3).map((h) => (
            <li key={`${h.date}-${h.opponent}`}>
              {h.date}: {h.formation ?? "?"} vs {h.opponent}
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: "0.35rem 0 0" }}>
          No formation history in club records yet.
        </p>
      )}
    </div>
  );
}

export function UpcomingFormationPanel() {
  const { batch, fixtures, loading: fixturesLoading, refreshing } = useUpcomingPredictions();
  const { ready, error, clubIndex } = usePredictionLogData();
  const { references, loading, error: formError, refresh } = useUpcomingFormationReferences(
    batch,
    fixtures,
    clubIndex,
    ready
  );
  const [leagueFilter, setLeagueFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const leagues = useMemo(() => {
    const set = new Set(references.map((r) => r.league));
    return [...set].sort();
  }, [references]);

  const filtered = useMemo(() => {
    if (leagueFilter === "all") return references;
    return references.filter((r) => r.league === leagueFilter);
  }, [references, leagueFilter]);

  const fixtureByApiId = useMemo(() => {
    const m = new Map(fixtures.map((f) => [f.apiFixtureId, f] as const));
    return m;
  }, [fixtures]);

  if (!ready || fixturesLoading) {
    return (
      <div>
        <UpcomingFixturesHeader />
        <p className="page-sub">Loading formation references…</p>
      </div>
    );
  }

  return (
    <div>
      <UpcomingFixturesHeader />

      {(error || formError) && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error ?? formError}
        </div>
      )}

      <div className="alert" style={{ marginBottom: "1rem", fontSize: "0.8125rem" }} role="status">
        <strong>Formation reference (advisory):</strong> traces each team&apos;s announced
        pre-match shape from API-Football when published, plus recent typical formations from
        settled Prediction Log batches. This category does not alter Half Goals, Total Goals, or
        Survival Ladder calculations.
      </div>

      <div
        className="card"
        style={{
          marginBottom: "1rem",
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          alignItems: "flex-end",
        }}
      >
        <label style={{ fontSize: "0.8125rem", fontWeight: 600 }}>
          League
          <select
            className="select"
            style={{ display: "block", marginTop: "0.25rem", minWidth: "12rem" }}
            value={leagueFilter}
            onChange={(e) => setLeagueFilter(e.target.value)}
          >
            <option value="all">All leagues</option>
            {leagues.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={loading || refreshing}
          onClick={() => void refresh()}
        >
          {loading ? "Tracing…" : "Refresh formations"}
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="page-sub">No upcoming fixtures to trace.</p>
      ) : (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {filtered.map((ref) => {
            const fx = fixtureByApiId.get(ref.apiFixtureId);
            const expanded = expandedId === ref.matchId;
            return (
              <div key={ref.matchId} className="card" style={{ padding: "0.85rem" }}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "0.65rem",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      {ref.homeTeam} vs {ref.awayTeam}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                      {formatKickoff(ref.kickoff)} · {leagueShortLabel(ref.league)} ·{" "}
                      {sourceLabel(ref.source)}
                      {ref.lineupStabilityPct != null
                        ? ` · stability ${ref.lineupStabilityPct}%`
                        : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                    {fx ? <OpenInDmButton row={fx} label="DM" /> : null}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: "0.75rem", padding: "0.3rem 0.5rem" }}
                      onClick={() =>
                        setExpandedId((id) => (id === ref.matchId ? null : ref.matchId))
                      }
                    >
                      {expanded ? "Hide trace" : "Show trace"}
                    </button>
                  </div>
                </div>

                {expanded ? (
                  <>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "1rem",
                        marginBottom: "0.65rem",
                      }}
                    >
                      <SideFormationBlock side={ref.home} align="left" />
                      <SideFormationBlock side={ref.away} align="right" />
                    </div>
                    <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: 0 }}>
                      {ref.referenceNote}
                    </p>
                  </>
                ) : (
                  <p style={{ fontSize: "0.8125rem", margin: 0 }}>
                    {ref.home.announced ?? ref.home.typical ?? "—"} vs{" "}
                    {ref.away.announced ?? ref.away.typical ?? "—"}
                    <span style={{ color: "var(--muted)" }}> · tap Show trace for history</span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
