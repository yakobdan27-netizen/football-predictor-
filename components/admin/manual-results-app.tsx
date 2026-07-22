"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { NEXT_MATCHES_LEAGUES } from "@/lib/football-api/fetch-upcoming-league";
import { teamsForLeague } from "@/lib/prediction-log/teams";
import type { ManualResultRecord } from "@/lib/prediction-log/manual-results-types";

function TeamSelect({
  id,
  label,
  league,
  value,
  onChange,
}: {
  id: string;
  label: string;
  league: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const teams = useMemo(() => teamsForLeague(league), [league]);
  const listId = `${id}-list`;
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Start typing…"
        required
      />
      <datalist id={listId}>
        {teams.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  );
}

export function ManualResultsApp() {
  const [league, setLeague] = useState<string>(NEXT_MATCHES_LEAGUES[0]);
  const [homeTeam, setHomeTeam] = useState("");
  const [awayTeam, setAwayTeam] = useState("");
  const [ftHome, setFtHome] = useState("0");
  const [ftAway, setFtAway] = useState("0");
  const [htHome, setHtHome] = useState("");
  const [htAway, setHtAway] = useState("");
  const [matchDate, setMatchDate] = useState("");
  const [records, setRecords] = useState<ManualResultRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rerunningId, setRerunningId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/manual-results?page=1&pageSize=50");
      const data = (await res.json()) as {
        records?: ManualResultRecord[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setRecords(data.records ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onLock() {
    await fetch("/api/admin/lock", { method: "POST" });
    window.location.reload();
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const ftH = Number(ftHome);
      const ftA = Number(ftAway);
      if (!Number.isInteger(ftH) || ftH < 0 || !Number.isInteger(ftA) || ftA < 0) {
        throw new Error("FT scores must be integers ≥ 0");
      }
      const hasHt = htHome.trim() !== "" || htAway.trim() !== "";
      let htH: number | undefined;
      let htA: number | undefined;
      if (hasHt) {
        htH = Number(htHome);
        htA = Number(htAway);
        if (
          !Number.isInteger(htH) ||
          htH < 0 ||
          !Number.isInteger(htA) ||
          htA < 0
        ) {
          throw new Error("HT scores must both be integers ≥ 0");
        }
      }
      if (!homeTeam.trim() || !awayTeam.trim()) {
        throw new Error("Home and away teams are required");
      }
      if (homeTeam.trim() === awayTeam.trim()) {
        throw new Error("Home and away must differ");
      }

      const res = await fetch("/api/admin/manual-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          league,
          homeTeam: homeTeam.trim(),
          awayTeam: awayTeam.trim(),
          ftHome: ftH,
          ftAway: ftA,
          htHome: htH,
          htAway: htA,
          matchDate: matchDate.trim() || undefined,
          filledBy: "admin",
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        batchesUpdated?: number;
        record?: ManualResultRecord;
      };
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setMessage(
        `Result saved. ${data.batchesUpdated ?? 0} batch(es) updated.`
      );
      setHomeTeam("");
      setAwayTeam("");
      setFtHome("0");
      setFtAway("0");
      setHtHome("");
      setHtAway("");
      setMatchDate("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onRerun(id: string) {
    setRerunningId(id);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/manual-results/${id}/rerun`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        error?: string;
        batchesUpdated?: number;
      };
      if (!res.ok) throw new Error(data.error ?? "Re-run failed");
      setMessage(
        `Re-run complete. ${data.batchesUpdated ?? 0} batch(es) updated.`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-run failed");
    } finally {
      setRerunningId(null);
    }
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "1rem",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <div>
          <h1 className="page-title">Manual results</h1>
          <p className="page-sub">
            Enter FT (and optional HT) to back-fill unsettled batch matches for
            the same team pair. Does not overwrite API-settled results.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link href="/" className="btn btn-secondary">
            Dashboard
          </Link>
          <button type="button" className="btn btn-secondary" onClick={onLock}>
            Lock admin
          </button>
        </div>
      </div>

      {message && (
        <div className="alert" style={{ marginBottom: "1rem" }}>
          {message}
        </div>
      )}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <form className="card" onSubmit={onSave} style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontWeight: 700, marginBottom: "0.75rem", fontSize: "1rem" }}>
          Fill result
        </h2>
        <div
          style={{
            display: "grid",
            gap: "0.75rem",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          }}
        >
          <div>
            <label className="label" htmlFor="mr-league">
              League
            </label>
            <select
              id="mr-league"
              className="input"
              value={league}
              onChange={(e) => {
                setLeague(e.target.value);
                setHomeTeam("");
                setAwayTeam("");
              }}
            >
              {NEXT_MATCHES_LEAGUES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <TeamSelect
            id="mr-home"
            label="Home"
            league={league}
            value={homeTeam}
            onChange={setHomeTeam}
          />
          <TeamSelect
            id="mr-away"
            label="Away"
            league={league}
            value={awayTeam}
            onChange={setAwayTeam}
          />
          <div>
            <label className="label" htmlFor="mr-ft-h">
              FT home
            </label>
            <input
              id="mr-ft-h"
              className="input"
              type="number"
              min={0}
              step={1}
              value={ftHome}
              onChange={(e) => setFtHome(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="mr-ft-a">
              FT away
            </label>
            <input
              id="mr-ft-a"
              className="input"
              type="number"
              min={0}
              step={1}
              value={ftAway}
              onChange={(e) => setFtAway(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="mr-ht-h">
              HT home (optional)
            </label>
            <input
              id="mr-ht-h"
              className="input"
              type="number"
              min={0}
              step={1}
              value={htHome}
              onChange={(e) => setHtHome(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="mr-ht-a">
              HT away (optional)
            </label>
            <input
              id="mr-ht-a"
              className="input"
              type="number"
              min={0}
              step={1}
              value={htAway}
              onChange={(e) => setHtAway(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="mr-date">
              Match date (optional)
            </label>
            <input
              id="mr-date"
              className="input"
              type="date"
              value={matchDate}
              onChange={(e) => setMatchDate(e.target.value)}
            />
          </div>
        </div>
        <div style={{ marginTop: "1rem" }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save result"}
          </button>
        </div>
      </form>

      <div className="card">
        <h2 style={{ fontWeight: 700, marginBottom: "0.75rem", fontSize: "1rem" }}>
          Recent fills
        </h2>
        {loading ? (
          <p className="page-sub">Loading…</p>
        ) : records.length === 0 ? (
          <p className="page-sub">No manual results yet.</p>
        ) : (
          <>
            <style>{`
              @media (max-width: 720px) {
                .admin-mr-table-wrap { display: none !important; }
                .admin-mr-cards { display: grid !important; gap: 0.75rem; }
              }
              @media (min-width: 721px) {
                .admin-mr-cards { display: none !important; }
              }
            `}</style>
            <div className="admin-mr-cards">
              {records.map((r) => (
                <div
                  key={`card-${r.id}`}
                  style={{
                    border: "1px solid var(--border, #ddd)",
                    borderRadius: 8,
                    padding: "0.75rem",
                    display: "grid",
                    gap: "0.35rem",
                    fontSize: "0.875rem",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {r.homeTeam} vs {r.awayTeam}
                  </div>
                  <div style={{ color: "var(--muted)" }}>{r.league}</div>
                  <div>
                    FT {r.ftHome}–{r.ftAway}
                    {r.htHome != null && r.htAway != null
                      ? ` · HT ${r.htHome}–${r.htAway}`
                      : ""}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                    {r.filledBy} · {new Date(r.filledAt).toLocaleString()} ·{" "}
                    {r.batchesUpdatedCount} batch(es) · manual
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: "0.8rem", padding: "0.35rem 0.6rem", justifySelf: "start" }}
                    disabled={rerunningId === r.id}
                    onClick={() => void onRerun(r.id)}
                  >
                    {rerunningId === r.id ? "…" : "Re-run match"}
                  </button>
                </div>
              ))}
            </div>
            <div className="admin-mr-table-wrap" style={{ overflowX: "auto" }}>
              <table className="table" style={{ width: "100%", minWidth: 720 }}>
                <thead>
                  <tr>
                    <th>League</th>
                    <th>Home</th>
                    <th>Away</th>
                    <th>FT</th>
                    <th>HT</th>
                    <th>Filled at</th>
                    <th>By</th>
                    <th>Batches</th>
                    <th>Source</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td>{r.league}</td>
                      <td>{r.homeTeam}</td>
                      <td>{r.awayTeam}</td>
                      <td>
                        {r.ftHome}–{r.ftAway}
                      </td>
                      <td>
                        {r.htHome != null && r.htAway != null
                          ? `${r.htHome}–${r.htAway}`
                          : "—"}
                      </td>
                      <td style={{ whiteSpace: "nowrap", fontSize: "0.8rem" }}>
                        {new Date(r.filledAt).toLocaleString()}
                      </td>
                      <td>{r.filledBy}</td>
                      <td>{r.batchesUpdatedCount}</td>
                      <td>manual</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem" }}
                          disabled={rerunningId === r.id}
                          onClick={() => void onRerun(r.id)}
                        >
                          {rerunningId === r.id ? "…" : "Re-run match"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
