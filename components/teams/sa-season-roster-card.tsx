"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  SaSeasonRosterStore,
  SaTeamSeasonCard,
} from "@/lib/prediction-log/sa-season-roster";
import {
  hydrateSaSeasonRosterFromServer,
  saveSaSeasonRoster,
} from "@/lib/prediction-log/storage";

function filledCount(card: SaTeamSeasonCard): number {
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

export function SaSeasonRosterCard() {
  const [store, setStore] = useState<SaSeasonRosterStore | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s = await hydrateSaSeasonRosterFromServer();
    setStore(s);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function verify() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sa-roster/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verify: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verify failed");
      saveSaSeasonRoster(data.store);
      setStore(data.store);
      const unmatched = data.unmatchedProvisional?.length ?? 0;
      if (data.overwritten) {
        setMsg(
          `Roster overwritten from API-Football (${data.store.teams?.length ?? 0} clubs).`
        );
      } else {
        setMsg(
          data.store.roster_verified
            ? `Verified ${data.matched?.length ?? 0} clubs against API-Football.`
            : `Verify done — ${unmatched} provisional slot(s) paused (no invent). ${data.store.verifyError ?? ""}`
        );
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Verify failed");
    } finally {
      setBusy(false);
    }
  }

  if (!store) {
    return <p className="page-sub">Loading Serie A 2026/27 roster…</p>;
  }

  const cards = store.teams
    .map((t) => store.cards[t])
    .filter(Boolean) as SaTeamSeasonCard[];

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
            Serie A 2026/27 roster
          </h2>
          <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: "0.35rem 0 0" }}>
            Numerics from DB/live only (null if missing). Style seeds are qualitative. Under-leaning
            league prior. Never blocks markets.
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
          {store.teams.length} teams · {store.promoted.length} promoted ·{" "}
          {store.mismatches.length} paused
        </span>
      </div>

      {msg && (
        <p style={{ fontSize: "0.8125rem", color: "var(--accent)", marginBottom: "0.75rem" }}>
          {msg}
        </p>
      )}

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
    </div>
  );
}
