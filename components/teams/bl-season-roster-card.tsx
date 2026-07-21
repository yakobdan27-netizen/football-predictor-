"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  BlSeasonRosterStore,
  BlTeamSeasonCard,
} from "@/lib/prediction-log/bl-season-roster";
import {
  hydrateBlSeasonRosterFromServer,
  saveBlSeasonRoster,
} from "@/lib/prediction-log/storage";

function filledCount(card: BlTeamSeasonCard): number {
  const fields = [
    card.matches_played,
    card.goals_scored_pg,
    card.goals_conceded_pg,
    card.over_2_5_rate,
    card.btts_rate,
    card.corners_won_pg,
    card.corners_conceded_pg,
    card.first_half_goal_rate,
    card.second_half_goal_rate,
    card.conceded_half_goals,
  ];
  return fields.filter((v) => v != null).length;
}

export function BlSeasonRosterCard() {
  const [store, setStore] = useState<BlSeasonRosterStore | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s = await hydrateBlSeasonRosterFromServer();
    setStore(s);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function verify() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/bl-roster/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verify: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verify failed");
      saveBlSeasonRoster(data.store);
      setStore(data.store);
      if (data.overwritten) {
        setMsg(
          `Roster overwritten from API-Football (${data.store.teams?.length ?? 0} clubs). verified=${String(data.store.roster_verified)}`
        );
      } else {
        setMsg(
          data.store.verifyError
            ? `Verify incomplete: ${data.store.verifyError}`
            : "Verify done — roster still empty (API-first; no invented 18)."
        );
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Verify failed");
    } finally {
      setBusy(false);
    }
  }

  if (!store) {
    return <p className="page-sub">Loading Bundesliga 2026/27 roster…</p>;
  }

  const cards = store.teams
    .map((t) => store.cards[t])
    .filter(Boolean) as BlTeamSeasonCard[];

  return (
    <div className="card" style={{ marginBottom: "1.25rem" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.75rem",
        }}
      >
        <div>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>
            Bundesliga 2026/27 roster
          </h2>
          <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: "0.35rem 0 0" }}>
            API-first (league 78) — no hardcoded 18. Numerics from DB/live only. Over/BTTS-leaning
            prior. Never blocks markets.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void verify()}
          >
            {busy ? "Verifying…" : "Verify vs API-Football"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <span
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            padding: "0.2rem 0.5rem",
            borderRadius: 4,
            background: store.roster_verified
              ? "rgba(34,197,94,0.15)"
              : "rgba(249,115,22,0.15)",
          }}
        >
          roster_verified = {String(store.roster_verified)}
        </span>
        <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          {store.teams.length} teams · {store.promoted.length} promoted · hints: Hamburg, Schalke
        </span>
      </div>

      {msg && (
        <p style={{ fontSize: "0.8125rem", color: "var(--accent)", marginBottom: "0.75rem" }}>
          {msg}
        </p>
      )}

      {store.teams.length === 0 ? (
        <p style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
          No clubs yet — run Verify to overwrite from API-Football season 2026.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                <th style={{ padding: "0.35rem 0.5rem" }}>Team</th>
                <th style={{ padding: "0.35rem 0.5rem" }}>Flags</th>
                <th style={{ padding: "0.35rem 0.5rem" }}>n</th>
                <th style={{ padding: "0.35rem 0.5rem" }}>Conf</th>
                <th style={{ padding: "0.35rem 0.5rem" }}>Filled</th>
                <th style={{ padding: "0.35rem 0.5rem" }}>Style seed</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.team} style={{ borderTop: "1px solid var(--border, #333)" }}>
                  <td style={{ padding: "0.4rem 0.5rem", fontWeight: 600 }}>{c.team}</td>
                  <td style={{ padding: "0.4rem 0.5rem" }}>
                    {c.is_promoted ? "promoted " : ""}
                    {c.seed_paused ? "paused" : ""}
                    {!c.is_promoted && !c.seed_paused ? "—" : ""}
                  </td>
                  <td style={{ padding: "0.4rem 0.5rem" }}>{c.matches_played ?? "—"}</td>
                  <td style={{ padding: "0.4rem 0.5rem" }}>{c.data_confidence.toFixed(2)}</td>
                  <td style={{ padding: "0.4rem 0.5rem" }}>{filledCount(c)}/10</td>
                  <td style={{ padding: "0.4rem 0.5rem", maxWidth: 280 }}>
                    {c.style_seed ? c.style_seed.leans.join(", ") : "null (DB-led)"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
