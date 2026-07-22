"use client";

import { useCallback, useEffect, useState } from "react";
import {
  NEXT_MATCHES_LEAGUES,
  type NextMatchesLeague,
  type UpcomingFixtureRow,
} from "@/lib/football-api/fetch-upcoming-league";
import type { CombinedOddsSettings, LogMatch } from "@/lib/prediction-log/types";
import { newId } from "@/lib/prediction-log/storage";
import {
  appendFixtureMatches,
  draftHasApiFixtureId,
  logMatchFromUpcomingFixture,
} from "@/lib/prediction-log/batch-fixture-picker";

function formatKickoff(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface BatchFixturePickerProps {
  matches: LogMatch[];
  comboSettings: CombinedOddsSettings;
  onMatchesChange: (matches: LogMatch[]) => void;
  onLeagueChange?: (league: NextMatchesLeague) => void;
}

export function BatchFixturePicker({
  matches,
  comboSettings,
  onMatchesChange,
  onLeagueChange,
}: BatchFixturePickerProps) {
  const [league, setLeague] = useState<NextMatchesLeague>("Premier League");
  const [fixtures, setFixtures] = useState<UpcomingFixtureRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async (leagueName: NextMatchesLeague, refresh: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({
        league: leagueName,
        next: "15",
        ...(refresh ? { refresh: "1" } : {}),
      });
      const res = await fetch(`/api/fixtures/upcoming?${q}`);
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        fixtures?: UpcomingFixtureRow[];
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load fixtures");
      setFixtures(data.fixtures ?? []);
    } catch (e) {
      setFixtures([]);
      setError(e instanceof Error ? e.message : "Failed to load fixtures");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(league, false);
  }, [league, load]);

  function addFixture(row: UpcomingFixtureRow) {
    setMsg(null);
    if (draftHasApiFixtureId(matches, row.apiFixtureId)) {
      setMsg("Already added to this batch.");
      return;
    }
    const next = logMatchFromUpcomingFixture(row, {
      id: newId(),
      settings: comboSettings,
    });
    onMatchesChange(appendFixtureMatches(matches, [next]));
    setMsg(`Added ${row.home.name} vs ${row.away.name}.`);
  }

  function removeMatch(id: string) {
    onMatchesChange(matches.filter((m) => m.id !== id));
  }

  const drafted = matches.filter(
    (m) => m.homeTeam.trim() && m.awayTeam.trim()
  );

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.75rem",
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>
            Add from upcoming fixtures
          </div>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
            Pick matches to pre-fill teams and date. Manual rows still work as a fallback.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={loading}
          onClick={() => void load(league, true)}
          style={{ minHeight: 40, minWidth: 88 }}
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <select
          className="select"
          value={league}
          onChange={(e) => {
            const next = e.target.value as NextMatchesLeague;
            setLeague(next);
            onLeagueChange?.(next);
          }}
          style={{ maxWidth: 220, minHeight: 40 }}
          aria-label="League for upcoming fixtures"
        >
          {NEXT_MATCHES_LEAGUES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p style={{ color: "var(--danger)", fontSize: "0.8125rem", margin: "0 0 0.5rem" }}>
          {error}
        </p>
      )}
      {msg && (
        <p style={{ color: "var(--accent)", fontSize: "0.8125rem", margin: "0 0 0.5rem" }}>
          {msg}
        </p>
      )}

      {drafted.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.4rem",
            marginBottom: "0.75rem",
          }}
        >
          {drafted.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => removeMatch(m.id)}
              title="Remove from batch"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                minHeight: 36,
                padding: "0.35rem 0.65rem",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--surface2)",
                fontSize: "0.75rem",
                cursor: "pointer",
                color: "inherit",
              }}
            >
              <span>
                {m.homeTeam} vs {m.awayTeam}
                {m.matchDate ? ` · ${m.matchDate}` : ""}
              </span>
              <span aria-hidden style={{ fontWeight: 700 }}>
                ×
              </span>
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          maxHeight: 280,
          overflowY: "auto",
          border: "1px solid var(--border)",
          borderRadius: 10,
          WebkitOverflowScrolling: "touch",
        }}
      >
        {loading && fixtures.length === 0 && (
          <p style={{ margin: "0.75rem", color: "var(--muted)", fontSize: "0.8125rem" }}>
            Loading upcoming fixtures…
          </p>
        )}
        {!loading && !error && fixtures.length === 0 && (
          <p style={{ margin: "0.75rem", color: "var(--muted)", fontSize: "0.8125rem" }}>
            No upcoming matches found.
          </p>
        )}
        {fixtures.map((row) => {
          const added = draftHasApiFixtureId(matches, row.apiFixtureId);
          return (
            <div
              key={row.apiFixtureId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.65rem 0.75rem",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "0.875rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.home.name} vs {row.away.name}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                  {formatKickoff(row.kickoffIso)}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={added}
                onClick={() => addFixture(row)}
                style={{ minHeight: 40, minWidth: 64, flexShrink: 0 }}
              >
                {added ? "Added" : "Add"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
