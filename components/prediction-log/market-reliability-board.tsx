"use client";

import type { MarketRank } from "@/lib/prediction-log/types";

interface MarketReliabilityBoardProps {
  top: MarketRank[];
  weakest: MarketRank[];
}

export function MarketReliabilityBoard({ top, weakest }: MarketReliabilityBoardProps) {
  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <h3 style={{ fontSize: "1rem", margin: "0 0 0.5rem" }}>Per-market reliability</h3>
      <p style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", color: "var(--muted)" }}>
        Where your logged picks are strongest and weakest (min sample required).
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: "0.8125rem", marginBottom: "0.35rem", color: "var(--accent)" }}>
            Strongest
          </div>
          {top.length === 0 ? (
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--muted)" }}>Not enough data yet.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.8125rem" }}>
              {top.map((m) => (
                <li key={m.market}>
                  {m.label}: <strong>{m.pct}%</strong> ({m.total})
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: "0.8125rem", marginBottom: "0.35rem", color: "var(--warn)" }}>
            Weakest
          </div>
          {weakest.length === 0 ? (
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--muted)" }}>Not enough data yet.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.8125rem" }}>
              {weakest.map((m) => (
                <li key={m.market}>
                  {m.label}: <strong>{m.pct}%</strong> ({m.total})
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
