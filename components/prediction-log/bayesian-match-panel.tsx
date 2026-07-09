"use client";

import { useMemo } from "react";
import { ScoreGridHeatmap } from "./score-grid-heatmap";
import { BAYESIAN_CONFIG } from "@/lib/prediction-log/bayesian-config";
import {
  computeBayesianMatchPrediction,
  getPosteriorMeansForDisplay,
} from "@/lib/prediction-log/bayesian-predict";
import type { ClubRecord } from "@/lib/prediction-log/club-record-types";
import type { LeagueBaselinesStore } from "@/lib/prediction-log/league-baselines";
import type { TeamsQualityStore } from "@/lib/prediction-log/teams-quality-types";
import type { LogMarketKey, LogMatch } from "@/lib/prediction-log/types";

interface BayesianMatchPanelProps {
  match: LogMatch;
  league: string;
  homeRecord: ClubRecord | null;
  awayRecord: ClubRecord | null;
  leagueBaselines: LeagueBaselinesStore | null;
  teamsQuality: TeamsQualityStore | null;
  lambdaDcHome?: number;
  lambdaDcAway?: number;
}

function intervalBadge(width: number): { label: string; color: string } {
  if (width <= BAYESIAN_CONFIG.MAX_INTERVAL_WIDTH_SAFE) {
    return { label: "Narrow", color: "var(--success, #22c55e)" };
  }
  if (width <= BAYESIAN_CONFIG.MAX_INTERVAL_WIDTH_BALANCED) {
    return { label: "Moderate", color: "var(--accent, #f59e0b)" };
  }
  return { label: "Wide", color: "var(--danger, #ef4444)" };
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function BayesianMatchPanel({
  match,
  league,
  homeRecord,
  awayRecord,
  leagueBaselines,
  teamsQuality,
  lambdaDcHome,
  lambdaDcAway,
}: BayesianMatchPanelProps) {
  const pickEntry = Object.entries(match.predictions)[0];
  const marketKey = (pickEntry?.[0] ?? "1x2") as LogMarketKey;
  const prediction = pickEntry?.[1]?.prediction ?? "home";
  const line = pickEntry?.[1]?.line;

  const result = useMemo(
    () =>
      computeBayesianMatchPrediction(
        homeRecord,
        awayRecord,
        league,
        leagueBaselines,
        teamsQuality,
        marketKey,
        prediction,
        line,
        BAYESIAN_CONFIG.MONTE_CARLO_SAMPLES
      ),
    [homeRecord, awayRecord, league, leagueBaselines, teamsQuality, marketKey, prediction, line]
  );

  const homePosteriors = getPosteriorMeansForDisplay(homeRecord);
  const awayPosteriors = getPosteriorMeansForDisplay(awayRecord);
  const primary = result.marketEstimates[marketKey];

  return (
    <div style={{ marginTop: "1rem", padding: "1rem", border: "1px solid var(--border)", borderRadius: 8 }}>
      <h4 style={{ fontSize: "0.95rem", marginBottom: "0.75rem" }}>Bayesian model (parallel)</h4>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
        <div>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.35rem" }}>
            {homeRecord?.clubName ?? match.homeTeam} posteriors
          </div>
          {homePosteriors.length === 0 ? (
            <p style={{ fontSize: "0.75rem", color: "var(--muted)" }}>No Bayesian data yet — enter results or run migrate.</p>
          ) : (
            <table style={{ fontSize: "0.72rem", width: "100%" }}>
              <tbody>
                {homePosteriors.slice(0, 8).map((p) => (
                  <tr key={p.key}>
                    <td>{p.key}</td>
                    <td style={{ textAlign: "right" }}>{p.mean.toFixed(2)}</td>
                    <td style={{ textAlign: "right", color: "var(--muted)" }}>n={p.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.35rem" }}>
            {awayRecord?.clubName ?? match.awayTeam} posteriors
          </div>
          {awayPosteriors.length === 0 ? (
            <p style={{ fontSize: "0.75rem", color: "var(--muted)" }}>No Bayesian data yet.</p>
          ) : (
            <table style={{ fontSize: "0.72rem", width: "100%" }}>
              <tbody>
                {awayPosteriors.slice(0, 8).map((p) => (
                  <tr key={p.key}>
                    <td>{p.key}</td>
                    <td style={{ textAlign: "right" }}>{p.type === "beta" ? pct(p.mean) : p.mean.toFixed(2)}</td>
                    <td style={{ textAlign: "right", color: "var(--muted)" }}>n={p.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div style={{ fontSize: "0.8rem", marginBottom: "0.75rem" }}>
        <strong>λ (Bayesian)</strong> home {result.lambdaHome.toFixed(2)} · away {result.lambdaAway.toFixed(2)}
        {lambdaDcHome != null && lambdaDcAway != null && (
          <span style={{ color: "var(--muted)", marginLeft: "0.5rem" }}>
            vs DC point λ {lambdaDcHome.toFixed(2)} / {lambdaDcAway.toFixed(2)}
          </span>
        )}
      </div>

      {primary && (
        <div style={{ marginBottom: "0.75rem", fontSize: "0.8rem" }}>
          <strong>{marketKey}</strong> ({prediction}): {pct(primary.point)}{" "}
          <span style={{ color: "var(--muted)" }}>
            [{pct(primary.lo)}, {pct(primary.hi)}]
          </span>{" "}
          <span
            style={{
              fontSize: "0.7rem",
              padding: "0.1rem 0.4rem",
              borderRadius: 4,
              background: "var(--surface)",
              color: intervalBadge(primary.intervalWidth).color,
            }}
          >
            {intervalBadge(primary.intervalWidth).label} interval
          </span>
        </div>
      )}

      <table style={{ fontSize: "0.75rem", width: "100%", marginBottom: "1rem" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Market</th>
            <th>Point</th>
            <th>95% interval</th>
            <th>Width</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(result.marketEstimates).map(([mk, est]) =>
            est ? (
              <tr key={mk}>
                <td>{mk}</td>
                <td style={{ textAlign: "center" }}>{pct(est.point)}</td>
                <td style={{ textAlign: "center", color: "var(--muted)" }}>
                  [{pct(est.lo)}, {pct(est.hi)}]
                </td>
                <td style={{ textAlign: "center" }}>{pct(est.intervalWidth)}</td>
              </tr>
            ) : null
          )}
        </tbody>
      </table>

      <div style={{ fontSize: "0.75rem", marginBottom: "0.35rem" }}>MC mean score grid</div>
      <ScoreGridHeatmap grid={result.scoreGridMean} />
    </div>
  );
}
