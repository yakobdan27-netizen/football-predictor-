"use client";

import { useCallback, useEffect, useState } from "react";
import { ADMIN_SLIPS_UNGUARDED_NOTICE } from "@/lib/bets/constants";
import { LIVE_SYNC_LEAGUES } from "@/lib/live/constants";
import { LEAGUE_API_IDS } from "@/lib/football-api/leagues";

type AdminSlip = {
  id: number;
  phone: string;
  displayName: string | null;
  createdAt: string;
  slipType: string;
  stake: number;
  totalOdd: number;
  potentialReturn: number;
  status: string;
  note: string | null;
  selections: Array<{
    id: number;
    eventLabel: string;
    marketLabel: string;
    chosenLabel: string;
    chosenOdd: number;
    result: string;
  }>;
};

type Summary = {
  totalSubmissions: number;
  uniquePhones: number;
  open: number;
  settled: number;
};

export function AdminSlipsApp({ slug }: { slug: string }) {
  const [slips, setSlips] = useState<AdminSlip[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState("");
  const [leagueId, setLeagueId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (phone.trim()) q.set("phone", phone.trim());
      if (status) q.set("status", status);
      if (leagueId) q.set("leagueId", leagueId);
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      const res = await fetch(`/api/ext/admin/slips?${q}`, {
        headers: { "x-admin-slips-slug": slug },
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        slips?: AdminSlip[];
        summary?: Summary;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Failed to load");
        setSlips([]);
      } else {
        setSlips(data.slips ?? []);
        setSummary(data.summary ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [slug, phone, status, leagueId, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  async function voidSlip(slipId: number) {
    setMsg(null);
    const res = await fetch("/api/ext/admin/slips", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-slips-slug": slug,
      },
      body: JSON.stringify({ action: "void", slipId }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    setMsg(data.ok ? `Voided #${slipId}` : data.error ?? "Void failed");
    void load();
  }

  async function settleAll() {
    setMsg(null);
    const res = await fetch("/api/ext/admin/slips", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-slips-slug": slug,
      },
      body: JSON.stringify({ action: "settle" }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      settledSlips?: number;
    };
    setMsg(
      data.ok
        ? `Settled ${data.settledSlips ?? 0} slip(s)`
        : data.error ?? "Settle failed"
    );
    void load();
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", paddingBottom: "2rem" }}>
      <div className="alert alert-error" role="status">
        {ADMIN_SLIPS_UNGUARDED_NOTICE}
      </div>

      <h1 className="page-title" style={{ fontSize: "1.35rem" }}>
        External slip submissions
      </h1>
      {summary && (
        <p className="page-sub">
          {summary.totalSubmissions} submissions · {summary.uniquePhones} phones ·{" "}
          {summary.open} open · {summary.settled} settled
        </p>
      )}

      <div
        className="card"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          alignItems: "flex-end",
          padding: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>
          Phone search
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={{ display: "block", marginTop: 2, width: "10rem" }}
          />
        </label>
        <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>
          Status
          <select
            className="select"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{ display: "block", marginTop: 2 }}
          >
            <option value="">All</option>
            <option value="SUBMITTED">SUBMITTED</option>
            <option value="WON">WON</option>
            <option value="LOST">LOST</option>
            <option value="VOID">VOID</option>
          </select>
        </label>
        <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>
          League
          <select
            className="select"
            value={leagueId}
            onChange={(e) => setLeagueId(e.target.value)}
            style={{ display: "block", marginTop: 2 }}
          >
            <option value="">All</option>
            {LIVE_SYNC_LEAGUES.map((name) => (
              <option key={name} value={String(LEAGUE_API_IDS[name])}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>
          From
          <input
            className="input"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{ display: "block", marginTop: 2 }}
          />
        </label>
        <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>
          To
          <input
            className="input"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{ display: "block", marginTop: 2 }}
          />
        </label>
        <button type="button" className="btn" disabled={loading} onClick={() => void load()}>
          {loading ? "Loading…" : "Filter"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void settleAll()}>
          Re-settle finished
        </button>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: "0.75rem" }}>
          {error}
        </div>
      )}
      {msg && (
        <div className="alert" style={{ marginBottom: "0.75rem" }}>
          {msg}
        </div>
      )}

      <div style={{ display: "grid", gap: "0.75rem" }}>
        {slips.map((s) => (
          <div key={s.id} className="card" style={{ padding: "0.85rem" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "0.5rem",
                flexWrap: "wrap",
              }}
            >
              <div>
                <strong>
                  #{s.id} · {s.phone}
                  {s.displayName ? ` (${s.displayName})` : ""}
                </strong>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                  {new Date(s.createdAt).toLocaleString()} · {s.slipType} · {s.status}
                </div>
              </div>
              <div style={{ fontSize: "0.8rem", textAlign: "right" }}>
                Stake {s.stake.toFixed(2)} · Odd {s.totalOdd.toFixed(2)} · Return{" "}
                {s.potentialReturn.toFixed(2)}
                {s.status === "SUBMITTED" && (
                  <div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: "0.7rem", marginTop: 4 }}
                      onClick={() => void voidSlip(s.id)}
                    >
                      Mark VOID
                    </button>
                  </div>
                )}
              </div>
            </div>
            <ul
              style={{
                margin: "0.5rem 0 0",
                paddingLeft: "1.1rem",
                fontSize: "0.8rem",
              }}
            >
              {s.selections.map((sel) => (
                <li key={sel.id}>
                  {sel.eventLabel} · {sel.marketLabel} · {sel.chosenLabel} @{" "}
                  {sel.chosenOdd.toFixed(2)} · {sel.result}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {!slips.length && !loading && (
          <p className="page-sub">No submissions match these filters.</p>
        )}
      </div>
    </div>
  );
}
