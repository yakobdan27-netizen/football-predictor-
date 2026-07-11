"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ABSOLUTE_STAKE_CAP_PCT,
  MIN_BETS_FOR_MEANINGFUL_METRICS,
  defaultBankrollStrategySettings,
} from "@/lib/prediction-log/recommendation-config";
import {
  collectSettledBets,
  computeEvaluationMetrics,
  evaluationRowsToCsv,
  runRealityCheckMonteCarlo,
  type MonteCarloResult,
} from "@/lib/prediction-log/evaluation-metrics";
import {
  evaluateBankrollHealth,
  evaluateStopLoss,
  formatMoney,
  maxRecommendedStake,
} from "@/lib/prediction-log/strategy-rules";
import {
  loadBatches,
  loadRecommendationSettings,
} from "@/lib/prediction-log/storage";
import {
  RealisticExpectationsBanner,
  WhatSuccessLooksLikeBlock,
} from "./realistic-expectations";

function SvgPolyline({
  values,
  width,
  height,
  stroke,
}: {
  values: number[];
  width: number;
  height: number;
  stroke: string;
}) {
  if (values.length === 0) {
    return (
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Empty chart">
        <text x={12} y={height / 2} fill="var(--muted)" fontSize="12">
          No settled stake legs yet
        </text>
      </svg>
    );
  }
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const pad = 8;
  const pts = values
    .map((v, i) => {
      const x = pad + (i / Math.max(1, values.length - 1)) * (width - pad * 2);
      const y = height - pad - ((v - min) / span) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");
  const zeroY = height - pad - ((0 - min) / span) * (height - pad * 2);
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img">
      <line
        x1={pad}
        x2={width - pad}
        y1={zeroY}
        y2={zeroY}
        stroke="var(--border)"
        strokeWidth="1"
      />
      <polyline fill="none" stroke={stroke} strokeWidth="2" points={pts} />
    </svg>
  );
}

function YieldBars({
  items,
}: {
  items: Array<{ label: string; value: number | null }>;
}) {
  const maxAbs = Math.max(1, ...items.map((i) => Math.abs(i.value ?? 0)));
  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      {items.map((item) => {
        const v = item.value;
        const w = v == null ? 0 : (Math.abs(v) / maxAbs) * 100;
        return (
          <div key={item.label} style={{ fontSize: "0.8125rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
              <span>Last {item.label}</span>
              <span>{v == null ? "—" : `${v}%`}</span>
            </div>
            <div
              style={{
                height: 10,
                background: "var(--surface2)",
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${w}%`,
                  background: v != null && v >= 0 ? "var(--success, #2a9d6e)" : "var(--danger)",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RiskEvaluationApp() {
  const batches = useMemo(() => loadBatches(), []);
  const settings = useMemo(() => {
    const s = loadRecommendationSettings();
    return s.bankrollStrategy ?? defaultBankrollStrategySettings();
  }, []);

  const metrics = useMemo(() => computeEvaluationMetrics(batches), [batches]);
  const stop = useMemo(() => evaluateStopLoss(batches, settings), [batches, settings]);
  const health = useMemo(() => evaluateBankrollHealth(settings), [settings]);
  const maxStake = maxRecommendedStake(settings);

  const [mcWinRate, setMcWinRate] = useState(
    () => metrics.winRate ?? 52
  );
  const [mcOdds, setMcOdds] = useState(() => metrics.avgOdds ?? 2.0);
  const [mcStakePct, setMcStakePct] = useState(
    () => Math.min(settings.maxRiskPctPerBet, ABSOLUTE_STAKE_CAP_PCT)
  );
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);

  function runMonteCarlo() {
    setMcResult(
      runRealityCheckMonteCarlo({
        winRatePct: mcWinRate,
        avgOdds: mcOdds,
        stakePct: mcStakePct,
        simulations: 2000,
        betsPerSim: 500,
        seed: 42,
      })
    );
  }

  function exportCsv() {
    const rows = collectSettledBets(batches);
    const csv = evaluationRowsToCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evaluation-bets-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <RealisticExpectationsBanner />
      <WhatSuccessLooksLikeBlock />

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.5rem" }}>
          Bankroll health
        </h2>
        <div style={{ fontSize: "0.875rem", color: "var(--muted)", lineHeight: 1.55 }}>
          <div>
            Current:{" "}
            <strong style={{ color: "inherit" }}>
              {settings.bankroll != null ? settings.bankroll : "not set"}
            </strong>
            {settings.startingBankroll != null
              ? ` · Start baseline ${settings.startingBankroll}`
              : ""}
            {settings.funBankroll != null ? ` · Fun ${settings.funBankroll}` : ""}
          </div>
          <div>
            Max risk {settings.maxRiskPctPerBet}% (cap {ABSOLUTE_STAKE_CAP_PCT}%)
            {maxStake != null ? ` · Max stake ${maxStake.toFixed(2)}` : ""}
            {health.ratioToStart != null ? ` · ${health.ratioToStart}% of start` : ""}
          </div>
          <div style={{ color: stop.stopLossActive ? "var(--danger)" : undefined }}>
            Stop-loss:{" "}
            {stop.stopLossActive
              ? `ACTIVE — ${stop.reason}`
              : `OK · ${stop.consecutiveLosses} consec. losses · ${settings.stopLossRollingDays}d drawdown ${stop.rollingDrawdownPct ?? 0}%`}
          </div>
          {health.messages.map((m) => (
            <div key={m} style={{ color: "var(--danger)" }}>
              {m}
            </div>
          ))}
          <div style={{ marginTop: "0.35rem" }}>
            <Link href="/settings" style={{ fontSize: "0.8125rem" }}>
              Edit bankroll settings →
            </Link>
          </div>
        </div>
      </section>

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.35rem" }}>
          Primary metrics
        </h2>
        {!metrics.metricsMeaningful ? (
          <p style={{ fontSize: "0.8125rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
            Metrics noisy until {MIN_BETS_FOR_MEANINGFUL_METRICS}+ settled stake bets (n=
            {metrics.n}).
          </p>
        ) : null}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: "0.75rem",
            fontSize: "0.875rem",
          }}
        >
          <Metric label="Settled bets" value={String(metrics.n)} />
          <Metric
            label="Yield"
            value={metrics.yieldPct != null ? `${metrics.yieldPct}%` : "—"}
          />
          <Metric
            label="ROI"
            value={metrics.roiPct != null ? `${metrics.roiPct}%` : "—"}
          />
          <Metric
            label="Win rate"
            value={metrics.winRate != null ? `${metrics.winRate}%` : "—"}
          />
          <Metric
            label="Avg odds"
            value={metrics.avgOdds != null ? String(metrics.avgOdds) : "—"}
          />
          <Metric
            label="Mean CLV"
            value={
              metrics.meanClvPct != null
                ? `${metrics.meanClvPct}pp (n=${metrics.clvSample})`
                : "—"
            }
          />
          <Metric
            label="Mean EV"
            value={metrics.meanEv != null ? formatMoney(metrics.meanEv) : "—"}
          />
          <Metric label="Max drawdown" value={String(metrics.maxDrawdown)} />
          <Metric label="Longest L streak" value={String(metrics.longestLosingStreak)} />
          <Metric
            label="Total P&L"
            value={metrics.n > 0 ? formatMoney(metrics.totalPnL) : "—"}
          />
        </div>
      </section>

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.5rem" }}>
          Cumulative P&L
        </h2>
        <SvgPolyline
          values={metrics.cumulativePnL}
          width={640}
          height={160}
          stroke="var(--accent)"
        />
      </section>

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.5rem" }}>
          Rolling yield
        </h2>
        <YieldBars
          items={[
            { label: "50", value: metrics.rollingYield50 },
            { label: "100", value: metrics.rollingYield100 },
            { label: "250", value: metrics.rollingYield250 },
          ]}
        />
      </section>

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.35rem" }}>
          CLV trend
        </h2>
        {metrics.clvSeries.length === 0 ? (
          <p style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
            No closing odds logged yet. On Prediction Log → Results, enter closing line in the{" "}
            <strong style={{ color: "inherit" }}>Close</strong> column after the market closes.
            CLV metrics appear only when closing odds are present.
          </p>
        ) : (
          <SvgPolyline
            values={metrics.clvSeries.map((c) => c.clvPct)}
            width={640}
            height={140}
            stroke="var(--accent)"
          />
        )}
      </section>

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.35rem" }}>
          Reality Check (Monte Carlo)
        </h2>
        <p style={{ fontSize: "0.8125rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
          Simulate 500 flat bets × 2000 paths. Shows P(bankroll falls to ≤50%). Illustrative only —
          not a forecast.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: "0.75rem",
            marginBottom: "0.75rem",
            maxWidth: 480,
          }}
        >
          <div>
            <label className="label">Win rate %</label>
            <input
              className="input"
              type="number"
              min={1}
              max={99}
              step={0.5}
              value={mcWinRate}
              onChange={(e) => setMcWinRate(parseFloat(e.target.value) || 50)}
            />
          </div>
          <div>
            <label className="label">Avg odds</label>
            <input
              className="input"
              type="number"
              min={1.01}
              step={0.05}
              value={mcOdds}
              onChange={(e) => setMcOdds(parseFloat(e.target.value) || 2)}
            />
          </div>
          <div>
            <label className="label">Stake % bankroll</label>
            <input
              className="input"
              type="number"
              min={0.1}
              max={ABSOLUTE_STAKE_CAP_PCT}
              step={0.1}
              value={mcStakePct}
              onChange={(e) =>
                setMcStakePct(
                  Math.min(
                    ABSOLUTE_STAKE_CAP_PCT,
                    Math.max(0.1, parseFloat(e.target.value) || 1)
                  )
                )
              }
            />
          </div>
        </div>
        <button type="button" className="btn" onClick={runMonteCarlo}>
          Run Reality Check
        </button>
        {mcResult ? (
          <div
            style={{
              marginTop: "0.75rem",
              fontSize: "0.875rem",
              lineHeight: 1.55,
              color: "var(--muted)",
            }}
          >
            <div>
              P(lose ≥50% bankroll):{" "}
              <strong style={{ color: "var(--danger)" }}>{mcResult.pRuin50}%</strong>
            </div>
            <div>
              Final bankroll median {mcResult.medianFinalBankrollPct}% · p5{" "}
              {mcResult.p5FinalBankrollPct}% · p95 {mcResult.p95FinalBankrollPct}%
            </div>
            <div>
              Inputs: WR {mcResult.winRate}% · odds · stake {mcResult.stakePct}% ·{" "}
              {mcResult.betsPerSim} bets × {mcResult.simulations} sims
            </div>
          </div>
        ) : null}
      </section>

      <div style={{ marginBottom: "1.5rem" }}>
        <button type="button" className="btn" onClick={exportCsv} disabled={metrics.n === 0}>
          Export settled bets CSV
        </button>
      </div>

      <RealisticExpectationsBanner compact />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontWeight: 700 }}>{value}</div>
    </div>
  );
}
