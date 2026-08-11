"use client";

import { useCallback, useEffect, useState } from "react";

type SystemInfo = {
  generatedAt: string;
  hist: {
    full: number;
    partial: number;
    missing: number;
    total: number;
    inventoryPass: number;
    providerHoles: number;
    gatePass: boolean;
    perCompetition: Array<{
      leagueName: string;
      stored: number;
      withCorners: number;
      withHt: number;
    }>;
  };
  dieh: {
    fittedAt: string | null;
    minValid: number;
    readyCount: number;
    leagues: Array<{
      leagueName: string;
      nValid: number;
      diehReady: boolean;
      goalsDistribution: string;
    }>;
  };
  meta: {
    lastRunAt: string | null;
    lastSummary: string | null;
    apiPlan: string | null;
    apiRemaining: number | null;
  };
  drain: {
    gapsRemaining: number;
    totalStored: number;
    mode: string;
    scheduleUtc: string[];
    scheduleNote: string;
  };
};

export function SystemInformation() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/system-info");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Failed to load system info");
      }
      setInfo(data as SystemInfo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading && !info) {
    return (
      <div className="card" style={{ marginBottom: "1rem" }}>
        <p className="page-sub" style={{ margin: 0 }}>Loading system information…</p>
      </div>
    );
  }

  if (error && !info) {
    return (
      <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
        {error}
      </div>
    );
  }

  if (!info) return null;

  const inv = info.hist.inventoryPass;
  const gate = info.hist.gatePass;

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          alignItems: "center",
          marginBottom: "0.75rem",
        }}
      >
        <h2 style={{ fontWeight: 700, fontSize: "1rem", margin: 0 }}>
          System information
        </h2>
        <button type="button" className="btn" style={{ fontSize: "0.75rem" }} onClick={() => void refresh()}>
          Refresh
        </button>
        <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
          {new Date(info.generatedAt).toLocaleString()}
        </span>
      </div>

      <div
        className="alert"
        role="status"
        style={{
          fontSize: "0.8rem",
          marginBottom: "0.75rem",
          borderColor: gate ? "var(--ok, #15803d)" : "var(--warn)",
        }}
      >
        <strong>Hist inventory:</strong> {inv}/{info.hist.total} pass ·{" "}
        {info.hist.full} full · {info.hist.partial} partial · {info.hist.missing}{" "}
        missing
        {info.hist.providerHoles > 0
          ? ` · ${info.hist.providerHoles} provider holes`
          : ""}
        — {gate ? "GATE PASS" : "FAIL (daily drain in progress)"}
      </div>

      {info.meta.lastSummary && (
        <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 0.75rem" }}>
          Last backfill: {info.meta.lastSummary}
          {info.meta.apiRemaining != null
            ? ` · API remaining: ${info.meta.apiRemaining}`
            : ""}
          {info.meta.lastRunAt
            ? ` · run ${new Date(info.meta.lastRunAt).toLocaleString()}`
            : ""}
        </p>
      )}

      <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: "0 0 0.75rem" }}>
        Daily drain: {info.drain.scheduleNote} · cron{" "}
        {info.drain.scheduleUtc.join(", ")} UTC · {info.drain.gapsRemaining} gaps
        left · {info.drain.totalStored.toLocaleString()} fixtures stored
      </p>

      <div className="stat-grid" style={{ marginBottom: "0.75rem" }}>
        <div>
          <div className="stat-value">{info.dieh.readyCount}</div>
          <div className="stat-label">DIEH-ready leagues</div>
        </div>
        <div>
          <div className="stat-value">{inv}</div>
          <div className="stat-label">Inventory buckets pass</div>
        </div>
        <div>
          <div className="stat-value">{info.drain.totalStored.toLocaleString()}</div>
          <div className="stat-label">Hist fixtures stored</div>
        </div>
        <div>
          <div className="stat-value">{info.drain.gapsRemaining}</div>
          <div className="stat-label">Gap buckets left</div>
        </div>
      </div>

      {info.dieh.fittedAt && (
        <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: "0 0 0.75rem" }}>
          Half-params fitted: {new Date(info.dieh.fittedAt).toLocaleString()}
        </p>
      )}

      <details>
        <summary style={{ cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 }}>
          Per-competition hist + DIEH
        </summary>
        <table
          style={{
            width: "100%",
            fontSize: "0.75rem",
            marginTop: "0.5rem",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)" }}>
              <th style={{ padding: "4px 6px" }}>League</th>
              <th style={{ padding: "4px 6px" }}>Stored</th>
              <th style={{ padding: "4px 6px" }}>HT</th>
              <th style={{ padding: "4px 6px" }}>Corners</th>
              <th style={{ padding: "4px 6px" }}>DIEH n</th>
              <th style={{ padding: "4px 6px" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {info.hist.perCompetition.map((c) => {
              const dieh = info.dieh.leagues.find(
                (d) => d.leagueName === c.leagueName
              );
              const ready = dieh?.diehReady ?? false;
              return (
                <tr key={c.leagueName}>
                  <td style={{ padding: "4px 6px" }}>{c.leagueName}</td>
                  <td style={{ padding: "4px 6px" }}>{c.stored}</td>
                  <td style={{ padding: "4px 6px" }}>{c.withHt}</td>
                  <td style={{ padding: "4px 6px" }}>{c.withCorners}</td>
                  <td style={{ padding: "4px 6px" }}>
                    {dieh?.nValid ?? "—"}
                  </td>
                  <td style={{ padding: "4px 6px", color: ready ? "#15803d" : "var(--muted)" }}>
                    {ready ? "DIEH live" : "insufficient"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </div>
  );
}
