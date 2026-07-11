"use client";

/**
 * Persistent realistic-expectations line — not marketing, decision support only.
 */
export function RealisticExpectationsBanner({ compact = false }: { compact?: boolean }) {
  return (
    <p
      className="realistic-expectations-banner"
      style={{
        fontSize: compact ? "0.75rem" : "0.8125rem",
        color: "var(--muted)",
        margin: compact ? "0.5rem 0 0" : "0 0 1rem",
        lineHeight: 1.45,
        borderTop: compact ? "1px solid var(--border)" : undefined,
        paddingTop: compact ? "0.5rem" : undefined,
      }}
    >
      Past performance does not guarantee future results. This is decision support, not guaranteed
      profit.
    </p>
  );
}

export function WhatSuccessLooksLikeBlock() {
  return (
    <section className="card" style={{ marginBottom: "1rem" }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.35rem" }}>
        What success looks like
      </h2>
      <ul
        style={{
          margin: 0,
          paddingLeft: "1.25rem",
          fontSize: "0.875rem",
          color: "var(--muted)",
          lineHeight: 1.55,
        }}
      >
        <li>Variance dominates short samples — treat metrics as noisy until 300+ settled bets.</li>
        <li>Bookmaker vig means even a fair model can lose money without a real edge.</li>
        <li>Beating closing odds (CLV) is a stronger long-term signal than raw short-term profit.</li>
        <li>Cap stakes (≤2% of bankroll) and respect stop-loss pauses to limit risk of ruin.</li>
        <li>Success is calibrated decisions and survival — not a guaranteed win rate.</li>
      </ul>
    </section>
  );
}
