"use client";

import { useState } from "react";
import type { BacktestMetricsResult } from "@/lib/predictor/types";

function MetricsPanel({
  title,
  metrics,
}: {
  title: string;
  metrics: BacktestMetricsResult;
}) {
  return (
    <div style={{ marginTop: "1.25rem" }}>
      <h3 style={{ fontWeight: 700, marginBottom: "0.75rem", fontSize: "0.9375rem" }}>
        {title}
      </h3>
      <div className="stat-grid">
        <div>
          <div className="stat-value">{metrics.nTest}</div>
          <div className="stat-label">Test fixtures</div>
        </div>
        <div>
          <div className="stat-value">{(metrics.accuracy1x2 * 100).toFixed(1)}%</div>
          <div className="stat-label">1X2 accuracy</div>
        </div>
        <div>
          <div className="stat-value">{metrics.brier1x2.toFixed(4)}</div>
          <div className="stat-label">Brier score</div>
        </div>
        <div>
          <div className="stat-value">
            {metrics.ece1x2 != null ? metrics.ece1x2.toFixed(3) : "—"}
          </div>
          <div className="stat-label">ECE (1X2)</div>
        </div>
      </div>
    </div>
  );
}

export default function BacktestPage() {
  const [metrics, setMetrics] = useState<BacktestMetricsResult | null>(null);
  const [metricsEnhanced, setMetricsEnhanced] = useState<BacktestMetricsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testFraction, setTestFraction] = useState("0.2");
  const [decayXi, setDecayXi] = useState("0.002");
  const [blendOdds, setBlendOdds] = useState(false);
  const [calibrate, setCalibrate] = useState(false);
  const [blendAlpha, setBlendAlpha] = useState("0.5");

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMetrics(null);
    setMetricsEnhanced(null);

    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testFraction: parseFloat(testFraction),
          decayXi: parseFloat(decayXi),
          minTrain: 50,
          blendOdds,
          blendAlpha: parseFloat(blendAlpha),
          calibrate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMetrics(data.metrics);
      setMetricsEnhanced(data.metricsEnhanced ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backtest failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">Backtest</h1>
      <p className="page-sub">
        Chronological train/test split on historical matches.
      </p>

      <form onSubmit={run} className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "grid", gap: "1rem" }}>
          <div>
            <label className="label">Test fraction</label>
            <input
              className="input"
              type="number"
              step="0.05"
              min="0.05"
              max="0.5"
              value={testFraction}
              onChange={(e) => setTestFraction(e.target.value)}
              inputMode="decimal"
            />
          </div>
          <div>
            <label className="label">Time decay (ξ)</label>
            <input
              className="input"
              type="number"
              step="0.0001"
              min="0"
              value={decayXi}
              onChange={(e) => setDecayXi(e.target.value)}
              inputMode="decimal"
            />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
            <input
              type="checkbox"
              checked={blendOdds}
              onChange={(e) => setBlendOdds(e.target.checked)}
            />
            Blend Bet365 odds on test fixtures with B365 data
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
            <input
              type="checkbox"
              checked={calibrate}
              onChange={(e) => setCalibrate(e.target.checked)}
            />
            Apply calibration (fit on train fold)
          </label>
          {blendOdds && (
            <div>
              <label className="label">Blend alpha</label>
              <input
                className="input"
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={blendAlpha}
                onChange={(e) => setBlendAlpha(e.target.value)}
                inputMode="decimal"
              />
            </div>
          )}
          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? "Running…" : "Run backtest"}
          </button>
        </div>
      </form>

      {error && <div className="alert alert-error">{error}</div>}

      {metrics && (
        <div className="card">
          <h2 style={{ fontWeight: 700, marginBottom: "1rem", fontSize: "1rem" }}>Results</h2>
          <MetricsPanel title="Model only" metrics={metrics} />
          {metricsEnhanced && (
            <MetricsPanel title="Enhanced (blend / calibrate)" metrics={metricsEnhanced} />
          )}

          {metrics.calibration1x2 && metrics.calibration1x2.length > 0 && (
            <details open style={{ marginTop: "1.25rem" }}>
              <summary className="label" style={{ cursor: "pointer", marginBottom: "0.75rem" }}>
                Calibration — 1X2 (model)
              </summary>
              <div className="mobile-cards">
                {metrics.calibration1x2.map((b) => (
                  <div key={b.bin} className="fixture-card" style={{ fontSize: "0.8125rem" }}>
                    <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>{b.bin}</div>
                    <div>
                      Predicted {(b.predicted * 100).toFixed(0)}% · Observed{" "}
                      {(b.observed * 100).toFixed(0)}% · n={b.count}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {metricsEnhanced?.calibration1x2 && metricsEnhanced.calibration1x2.length > 0 && (
            <details style={{ marginTop: "1rem" }}>
              <summary className="label" style={{ cursor: "pointer", marginBottom: "0.75rem" }}>
                Calibration — 1X2 (enhanced)
              </summary>
              <div className="mobile-cards">
                {metricsEnhanced.calibration1x2.map((b) => (
                  <div key={b.bin} className="fixture-card" style={{ fontSize: "0.8125rem" }}>
                    <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>{b.bin}</div>
                    <div>
                      Predicted {(b.predicted * 100).toFixed(0)}% · Observed{" "}
                      {(b.observed * 100).toFixed(0)}% · n={b.count}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
