"use client";

import { useCallback, useEffect, useState } from "react";
import type { BacktestMetricsResult } from "@/lib/predictor/types";
import { LEAGUE_OPTIONS } from "@/lib/prediction-log/markets-config";
import type {
  RecoBacktestMode,
  RecoBacktestResult,
} from "@/lib/prediction-log/backtest-engine";
import type { RecoBacktestRunMeta } from "@/lib/prediction-log/backtest-store";

type TabId = "reco" | "dixon";

function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v}%`;
}

function csvEscape(v: string | number | boolean | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadRecoCsv(run: RecoBacktestResult) {
  const headers = [
    "date",
    "league",
    "home",
    "away",
    "score",
    "pick_1x2",
    "p_1x2",
    "hit_1x2",
    "brier_1x2",
    "pick_ou25",
    "p_ou25",
    "hit_ou25",
    "pick_btts",
    "p_btts",
    "hit_btts",
    "cs_pick",
    "cs_hit",
    "odds",
    "roi_unit",
  ];
  const lines = [headers.join(",")];
  for (const r of run.rows) {
    lines.push(
      [
        r.date,
        r.league,
        r.homeTeam,
        r.awayTeam,
        `${r.hg}-${r.ag}`,
        r.pick1x2,
        r.p1x2,
        r.hit1x2,
        r.brier1x2.toFixed(4),
        r.pickOu25,
        r.pOu25,
        r.hitOu25,
        r.pickBtts,
        r.pBtts,
        r.hitBtts,
        r.csPick ?? "",
        r.csHit == null ? "" : r.csHit,
        r.stakeOdds ?? "",
        r.roiUnit ?? "",
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  lines.push("");
  lines.push("summary_metric,value");
  const s = run.summary;
  lines.push(`n,${s.nMatches}`);
  lines.push(`1x2_accuracy,${s.oneX2.accuracy ?? ""}`);
  lines.push(`1x2_brier,${s.oneX2.brier ?? ""}`);
  lines.push(`1x2_ece,${s.oneX2.ece ?? ""}`);
  lines.push(`ou25_accuracy,${s.ou25.accuracy ?? ""}`);
  lines.push(`btts_accuracy,${s.btts.accuracy ?? ""}`);
  lines.push(`cs_accuracy,${s.correctScore.accuracy ?? ""}`);
  lines.push(`value_hit_rate,${s.value.accuracy ?? ""}`);
  lines.push(`roi_pct,${s.roi.roiPct ?? ""}`);

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reco-backtest-${run.id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

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

function MonthBars({
  monthly,
}: {
  monthly: RecoBacktestResult["monthly"];
}) {
  if (!monthly.length) return null;
  const max = Math.max(...monthly.map((m) => m.hitRate ?? 0), 1);
  return (
    <div style={{ marginTop: "1.25rem" }}>
      <h3 style={{ fontWeight: 700, marginBottom: "0.75rem", fontSize: "0.9375rem" }}>
        1X2 hit rate by month
      </h3>
      <div style={{ display: "grid", gap: "0.5rem" }}>
        {monthly.map((m) => {
          const rate = m.hitRate ?? 0;
          const width = `${(rate / max) * 100}%`;
          return (
            <div key={m.month} style={{ fontSize: "0.8125rem" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "0.2rem",
                }}
              >
                <span>
                  {m.month}{" "}
                  <span style={{ opacity: 0.65 }}>
                    (n={m.n}
                    {m.cumulativeHitRate != null
                      ? ` · cum ${m.cumulativeHitRate}%`
                      : ""}
                    )
                  </span>
                </span>
                <span style={{ fontWeight: 600 }}>{pct(m.hitRate)}</span>
              </div>
              <div
                style={{
                  height: 8,
                  background: "var(--border, #e5e5e5)",
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width,
                    background: "var(--accent, #2563eb)",
                    borderRadius: 4,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MatchList({
  title,
  rows,
}: {
  title: string;
  rows: RecoBacktestResult["top"];
}) {
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: "1.25rem" }}>
      <h3 style={{ fontWeight: 700, marginBottom: "0.75rem", fontSize: "0.9375rem" }}>
        {title}
      </h3>
      <div className="mobile-cards">
        {rows.map((r) => (
          <div
            key={`${r.batchId}-${r.matchId}`}
            className="fixture-card"
            style={{ fontSize: "0.8125rem" }}
          >
            <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>
              {r.homeTeam} {r.hg}-{r.ag} {r.awayTeam}
            </div>
            <div style={{ opacity: 0.8 }}>
              {r.date} · {r.league}
            </div>
            <div style={{ marginTop: "0.35rem" }}>
              1X2 {r.pick1x2} ({r.p1x2}%) {r.hit1x2 ? "✓" : "✗"} · O/U{" "}
              {r.pickOu25} {r.hitOu25 ? "✓" : "✗"} · BTTS {r.pickBtts}{" "}
              {r.hitBtts ? "✓" : "✗"}
              {r.csPick != null && (
                <>
                  {" "}
                  · CS {r.csPick} {r.csHit ? "✓" : "✗"}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecoTab() {
  const [mode, setMode] = useState<RecoBacktestMode>("full");
  const [leagues, setLeagues] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RecoBacktestResult | null>(null);
  const [saved, setSaved] = useState<RecoBacktestRunMeta[]>([]);
  const [selectedSaved, setSelectedSaved] = useState("");

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/backtest-reco");
      const data = await res.json();
      if (res.ok) setSaved(data.runs ?? []);
    } catch {
      /* ignore list errors */
    }
  }, []);

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  function toggleLeague(league: string) {
    setLeagues((prev) =>
      prev.includes(league) ? prev.filter((l) => l !== league) : [...prev, league]
    );
  }

  async function runBacktest(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/backtest-reco", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          leagues: leagues.length ? leagues : undefined,
          dateFrom: mode === "custom" && dateFrom ? dateFrom : undefined,
          dateTo: mode === "custom" && dateTo ? dateTo : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRun(data.run);
      setSelectedSaved(data.run.id);
      await loadSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backtest failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadSavedRun(id: string) {
    if (!id) return;
    setSelectedSaved(id);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/backtest-reco?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRun(data.run);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run");
    } finally {
      setLoading(false);
    }
  }

  const s = run?.summary;

  return (
    <div>
      <p className="page-sub" style={{ marginTop: 0 }}>
        No-lookahead walk-forward of the live recommendation engine over prediction-log
        history (including Livescore bulk results).
      </p>

      <form onSubmit={runBacktest} className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "grid", gap: "1rem" }}>
          <div>
            <label className="label">Mode</label>
            <select
              className="input"
              value={mode}
              onChange={(e) => setMode(e.target.value as RecoBacktestMode)}
            >
              <option value="full">Full history</option>
              <option value="rolling_3">Rolling last 3 months</option>
              <option value="rolling_6">Rolling last 6 months</option>
              <option value="rolling_12">Rolling last 12 months</option>
              <option value="custom">Custom date range</option>
            </select>
          </div>

          {mode === "custom" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.75rem",
              }}
            >
              <div>
                <label className="label">From</label>
                <input
                  className="input"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="label">To</label>
                <input
                  className="input"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>
          )}

          <div>
            <label className="label">Leagues (optional — empty = all)</label>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.5rem",
                marginTop: "0.35rem",
              }}
            >
              {LEAGUE_OPTIONS.map((league) => (
                <label
                  key={league}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    fontSize: "0.8125rem",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={leagues.includes(league)}
                    onChange={() => toggleLeague(league)}
                  />
                  {league}
                </label>
              ))}
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? "Running walk-forward…" : "Run recommendation backtest"}
          </button>
        </div>
      </form>

      {saved.length > 0 && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <label className="label">Saved runs</label>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <select
              className="input"
              style={{ flex: 1, minWidth: 200 }}
              value={selectedSaved}
              onChange={(e) => void loadSavedRun(e.target.value)}
            >
              <option value="">Select a run…</option>
              {saved.map((r) => (
                <option key={r.id} value={r.id}>
                  {new Date(r.createdAt).toLocaleString()} · {r.config.mode} · n=
                  {r.nMatches} · 1X2 {pct(r.summary.oneX2.accuracy)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {run?.warning && (
        <div className="alert" style={{ marginBottom: "1rem" }}>
          {run.warning}
        </div>
      )}

      {s && run && (
        <div className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.75rem",
              flexWrap: "wrap",
              marginBottom: "1rem",
            }}
          >
            <h2 style={{ fontWeight: 700, fontSize: "1rem", margin: 0 }}>Results</h2>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => downloadRecoCsv(run)}
            >
              Export CSV
            </button>
          </div>

          <div className="stat-grid">
            <div>
              <div className="stat-value">{s.nMatches}</div>
              <div className="stat-label">Matches</div>
            </div>
            <div>
              <div className="stat-value">{pct(s.oneX2.accuracy)}</div>
              <div className="stat-label">1X2 accuracy</div>
            </div>
            <div>
              <div className="stat-value">
                {s.oneX2.brier != null ? s.oneX2.brier.toFixed(4) : "—"}
              </div>
              <div className="stat-label">Brier (1X2)</div>
            </div>
            <div>
              <div className="stat-value">
                {s.oneX2.ece != null ? s.oneX2.ece.toFixed(3) : "—"}
              </div>
              <div className="stat-label">ECE (1X2)</div>
            </div>
            <div>
              <div className="stat-value">{pct(s.ou25.accuracy)}</div>
              <div className="stat-label">O/U 2.5</div>
            </div>
            <div>
              <div className="stat-value">{pct(s.btts.accuracy)}</div>
              <div className="stat-label">BTTS</div>
            </div>
            <div>
              <div className="stat-value">{pct(s.correctScore.accuracy)}</div>
              <div className="stat-label">
                Correct score{s.correctScore.n ? ` (n=${s.correctScore.n})` : ""}
              </div>
            </div>
            <div>
              <div className="stat-value">
                {s.roi.roiPct != null ? `${s.roi.roiPct}%` : "N/A"}
              </div>
              <div className="stat-label">
                ROI{s.roi.n ? ` (n=${s.roi.n})` : " (no odds)"}
              </div>
            </div>
            <div>
              <div className="stat-value">{pct(s.value.accuracy)}</div>
              <div className="stat-label">
                Value hits{s.value.n ? ` (n=${s.value.n})` : ""}
              </div>
            </div>
          </div>

          <MonthBars monthly={run.monthly} />

          {Object.keys(run.byLeague).length > 0 && (
            <div style={{ marginTop: "1.25rem" }}>
              <h3
                style={{ fontWeight: 700, marginBottom: "0.75rem", fontSize: "0.9375rem" }}
              >
                By league
              </h3>
              <div className="mobile-cards">
                {Object.entries(run.byLeague).map(([league, b]) => (
                  <div key={league} className="fixture-card" style={{ fontSize: "0.8125rem" }}>
                    <div style={{ fontWeight: 700 }}>{league}</div>
                    <div>
                      n={b.n} · 1X2 {pct(b.oneX2)} · O/U {pct(b.ou25)} · BTTS{" "}
                      {pct(b.btts)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <MatchList title="Top predictions" rows={run.top} />
          <MatchList title="Worst predictions" rows={run.worst} />
        </div>
      )}
    </div>
  );
}

function DixonTab() {
  const [metrics, setMetrics] = useState<BacktestMetricsResult | null>(null);
  const [metricsEnhanced, setMetricsEnhanced] = useState<BacktestMetricsResult | null>(
    null
  );
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
      <p className="page-sub" style={{ marginTop: 0 }}>
        Chronological train/test holdout on Postgres match history (Dixon-Coles model).
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
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              fontSize: "0.875rem",
            }}
          >
            <input
              type="checkbox"
              checked={blendOdds}
              onChange={(e) => setBlendOdds(e.target.checked)}
            />
            Blend Bet365 odds on test fixtures with B365 data
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              fontSize: "0.875rem",
            }}
          >
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
            {loading ? "Running…" : "Run model holdout"}
          </button>
        </div>
      </form>

      {error && <div className="alert alert-error">{error}</div>}

      {metrics && (
        <div className="card">
          <h2 style={{ fontWeight: 700, marginBottom: "1rem", fontSize: "1rem" }}>
            Results
          </h2>
          <MetricsPanel title="Model only" metrics={metrics} />
          {metricsEnhanced && (
            <MetricsPanel
              title="Enhanced (blend / calibrate)"
              metrics={metricsEnhanced}
            />
          )}

          {metrics.calibration1x2 && metrics.calibration1x2.length > 0 && (
            <details open style={{ marginTop: "1.25rem" }}>
              <summary
                className="label"
                style={{ cursor: "pointer", marginBottom: "0.75rem" }}
              >
                Calibration — 1X2 (model)
              </summary>
              <div className="mobile-cards">
                {metrics.calibration1x2.map((b) => (
                  <div
                    key={b.bin}
                    className="fixture-card"
                    style={{ fontSize: "0.8125rem" }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>
                      {b.bin}
                    </div>
                    <div>
                      Predicted {(b.predicted * 100).toFixed(0)}% · Observed{" "}
                      {(b.observed * 100).toFixed(0)}% · n={b.count}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {metricsEnhanced?.calibration1x2 &&
            metricsEnhanced.calibration1x2.length > 0 && (
              <details style={{ marginTop: "1rem" }}>
                <summary
                  className="label"
                  style={{ cursor: "pointer", marginBottom: "0.75rem" }}
                >
                  Calibration — 1X2 (enhanced)
                </summary>
                <div className="mobile-cards">
                  {metricsEnhanced.calibration1x2.map((b) => (
                    <div
                      key={b.bin}
                      className="fixture-card"
                      style={{ fontSize: "0.8125rem" }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>
                        {b.bin}
                      </div>
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

export default function BacktestPage() {
  const [tab, setTab] = useState<TabId>("reco");

  return (
    <div>
      <h1 className="page-title">Backtest</h1>
      <p className="page-sub">
        Evaluate prediction quality — recommendation walk-forward or Dixon-Coles holdout.
      </p>

      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "1.25rem",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className={tab === "reco" ? "btn btn-primary" : "btn btn-secondary"}
          onClick={() => setTab("reco")}
        >
          Recommendation walk-forward
        </button>
        <button
          type="button"
          className={tab === "dixon" ? "btn btn-primary" : "btn btn-secondary"}
          onClick={() => setTab("dixon")}
        >
          Dixon-Coles model
        </button>
      </div>

      {tab === "reco" ? <RecoTab /> : <DixonTab />}
    </div>
  );
}
