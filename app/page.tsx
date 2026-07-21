"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { UploadCsv, SeedButton } from "@/components/upload-seed";

export default function DashboardPage() {
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/seed");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMatchCount(data.matches);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load stats");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-sub">
        Dixon-Coles predictions with time-decay weighting.
      </p>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: "1rem" }}>
        <div className="card">
          <div className="stat-value">{matchCount ?? "—"}</div>
          <div className="stat-label">Training matches</div>
        </div>
      </div>

      <div className="grid-2-wide" style={{ marginBottom: "1rem" }}>
        <div className="card">
          <h2 style={{ fontWeight: 700, marginBottom: "0.5rem", fontSize: "1rem" }}>
            Get started
          </h2>
          <p style={{ color: "var(--muted)", fontSize: "0.875rem", marginBottom: "0.75rem" }}>
            Load demo data or upload a football-data.co.uk CSV.
          </p>
          <div className="action-stack">
            <SeedButton onSuccess={refresh} />
            <UploadCsv onSuccess={refresh} />
          </div>
        </div>

        <div className="card">
          <h2 style={{ fontWeight: 700, marginBottom: "0.5rem", fontSize: "1rem" }}>
            Quick actions
          </h2>
          <div className="action-stack">
            <Link href="/prediction-log" className="btn btn-primary btn-full">
              Prediction Log
            </Link>
            <Link href="/ai-learner" className="btn btn-secondary btn-full">
              AI Learner
            </Link>
            <Link href="/recommendation" className="btn btn-secondary btn-full">
              Recommendation
            </Link>
            <Link href="/decision-maker" className="btn btn-secondary btn-full">
              Decision Maker
            </Link>
            <Link href="/highest-scoring-half" className="btn btn-secondary btn-full">
              Half Goals (1H vs 2H)
            </Link>
            <Link href="/corners-analysis" className="btn btn-secondary btn-full">
              Corners Analysis
            </Link>
            <Link href="/combined-odds" className="btn btn-secondary btn-full">
              Combined Odds
            </Link>
            <Link href="/analysis" className="btn btn-secondary btn-full">
              Analysis
            </Link>
            <Link href="/backtest" className="btn btn-secondary btn-full">
              Run backtest
            </Link>
            <Link href="/guide" className="btn btn-secondary btn-full">
              Operating guide
            </Link>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ fontWeight: 700, marginBottom: "0.5rem", fontSize: "1rem" }}>Models</h2>
        <ul style={{ color: "var(--muted)", fontSize: "0.875rem", lineHeight: 1.7, paddingLeft: "1.1rem" }}>
          <li>Goals W/D/L & O/U — Dixon-Coles</li>
          <li>Half goals (1H vs 2H) — attack×defence λs with tempo nudges</li>
          <li>1X2 ML — gradient boosting (XGBoost-style) + calibration</li>
          <li>Shots, SOT, Offsides — Poisson strength</li>
          <li>Time decay — recent matches weighted more</li>
        </ul>
      </div>
    </div>
  );
}
