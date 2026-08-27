"use client";

import { useMemo, type CSSProperties } from "react";
import { matchLeague } from "@/lib/prediction-log/match-league";
import {
  predictCornersMatch,
  type CornersConfidence,
} from "@/lib/prediction-log/corners-model";
import {
  computeLeagueHalfShare,
  computeTeamHalfShare,
} from "@/lib/prediction-log/hsh-model";
import { poissonOverLine } from "@/lib/prediction-log/poisson-ou";
import { usePredictionLogData } from "./use-prediction-log-data";
import { useAnalysisFixtureBatch } from "./use-analysis-fixture-batch";
import { AnalysisFixtureSourceControls } from "./analysis-fixture-source-controls";
import { useHshPredictions } from "./use-hsh-predictions";
import {
  BlendedAnalysisNotice,
  pickBlendFromEstimates,
} from "@/components/analysis/blended-analysis-notice";

const W_TEAM = 0.65;
const HT_CORNERS_LINE = 4.5;

function pctProb(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function confidenceStyle(c: CornersConfidence): CSSProperties {
  switch (c) {
    case "high":
      return { background: "rgba(34, 197, 94, 0.2)", color: "#15803d" };
    case "medium":
      return { background: "rgba(245, 158, 11, 0.2)", color: "#b45309" };
    default:
      return { background: "var(--surface2)", color: "var(--muted)" };
  }
}

type HalftimeCornersRow = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  lambdaHome1h: number;
  lambdaAway1h: number;
  expectedTotal: number;
  pOver45: number;
  pUnder45: number;
  share1hHome: number;
  share1hAway: number;
  confidence: CornersConfidence;
  lean: "over_4.5" | "under_4.5" | "lean_none";
  topProbability: number;
};

export function HalftimeCornersApp() {
  const { ready, error, batches } = usePredictionLogData();
  const {
    batch,
    fixtureSource,
    setFixtureSource,
    batchId,
    setBatchId,
    sortedBatches,
    weekend,
    loading: weekendLoading,
  } = useAnalysisFixtureBatch();
  const { estimatesById } = useHshPredictions(batch, batches, {});

  const rows = useMemo(() => {
    if (!batch) return [] as HalftimeCornersRow[];
    const out: HalftimeCornersRow[] = [];

    for (const match of batch.matches) {
      const league = matchLeague(match, batch.league);
      const full = predictCornersMatch({
        matchId: match.id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        league,
        batches,
        beforeDate: batch.date,
      });
      const est = estimatesById[match.id];
      const lambdaHomeFt = est?.lambdas.home_corners ?? full.lambdaHome;
      const lambdaAwayFt = est?.lambdas.away_corners ?? full.lambdaAway;

      const leagueHalf = computeLeagueHalfShare(batches, league, {
        beforeDate: batch.date,
      });
      const homeHalf = computeTeamHalfShare(batches, match.homeTeam, "home", {
        beforeDate: batch.date,
        league,
      });
      const awayHalf = computeTeamHalfShare(batches, match.awayTeam, "away", {
        beforeDate: batch.date,
        league,
      });

      const share1hHome =
        W_TEAM * homeHalf.share1h + (1 - W_TEAM) * leagueHalf.league1hShare;
      const share1hAway =
        W_TEAM * awayHalf.share1h + (1 - W_TEAM) * leagueHalf.league1hShare;

      const lambdaHome1h = lambdaHomeFt * share1hHome;
      const lambdaAway1h = lambdaAwayFt * share1hAway;
      const expectedTotal = lambdaHome1h + lambdaAway1h;
      const pOver45 = poissonOverLine(HT_CORNERS_LINE, expectedTotal);
      const pUnder45 = 1 - pOver45;
      const margin = Math.abs(pOver45 - pUnder45);
      const confidence: CornersConfidence =
        margin >= 0.15 ? "high" : margin >= 0.07 ? "medium" : "low";
      const lean =
        margin < 0.05
          ? "lean_none"
          : pOver45 >= pUnder45
            ? "over_4.5"
            : "under_4.5";
      const topProbability = Math.max(pOver45, pUnder45);

      out.push({
        matchId: match.id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        league,
        lambdaHome1h,
        lambdaAway1h,
        expectedTotal,
        pOver45,
        pUnder45,
        share1hHome,
        share1hAway,
        confidence,
        lean,
        topProbability,
      });
    }

    return out;
  }, [batch, batches, estimatesById]);

  const blendNotice = useMemo(
    () => pickBlendFromEstimates(estimatesById),
    [estimatesById]
  );

  if (!ready || (fixtureSource === "weekend" && weekendLoading)) {
    return <p className="page-sub">Loading…</p>;
  }

  return (
    <div>
      {error && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <BlendedAnalysisNotice blend={blendNotice} pageLabel="Halftime Corners" />

      <div style={{ marginBottom: "1.25rem" }}>
        <h1 className="page-title">Halftime Corners (1H)</h1>
        <p className="page-sub">
          First-half corner expectation from full-match λ scaled by the same team/league 1H goal
          shares used in Half Goals — not by halving totals blindly. O/U {HT_CORNERS_LINE} on 1H
          corners won total. Advisory only.
        </p>
      </div>

      <div
        className="card"
        style={{
          marginBottom: "1rem",
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
          alignItems: "flex-end",
        }}
      >
        <AnalysisFixtureSourceControls
          fixtureSource={fixtureSource}
          onSourceChange={setFixtureSource}
          batchId={batchId}
          onBatchIdChange={setBatchId}
          sortedBatches={sortedBatches}
          onRefresh={() => void weekend.refresh()}
          refreshing={weekend.refreshing}
        />
      </div>

      {!batch ? (
        <p className="page-sub">
          {fixtureSource === "weekend"
            ? weekendLoading
              ? "Loading Weekend Picks…"
              : "No Weekend Picks batch available. Run Match Centre weekend scoring or switch to a saved batch."
            : "Select a saved batch to run halftime corner estimates."}
        </p>
      ) : rows.length === 0 ? (
        <p className="page-sub">This batch has no matches.</p>
      ) : (
        <div className="card">
          <table className="table mobile-stack-table" style={{ width: "100%", fontSize: "0.8125rem" }}>
            <thead>
              <tr>
                <th>Match</th>
                <th>λ 1H H</th>
                <th>λ 1H A</th>
                <th>E[1H total]</th>
                <th>P(O4.5)</th>
                <th>P(U4.5)</th>
                <th>Lean</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.matchId}>
                  <td data-label="Match">
                    <div style={{ fontWeight: 600 }}>{r.homeTeam} vs {r.awayTeam}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{r.league}</div>
                  </td>
                  <td data-label="λ 1H H">{r.lambdaHome1h.toFixed(2)}</td>
                  <td data-label="λ 1H A">{r.lambdaAway1h.toFixed(2)}</td>
                  <td data-label="E[1H total]">{r.expectedTotal.toFixed(2)}</td>
                  <td data-label="P(O4.5)">{pctProb(r.pOver45)}</td>
                  <td data-label="P(U4.5)">{pctProb(r.pUnder45)}</td>
                  <td data-label="Lean">
                    {r.lean === "lean_none"
                      ? "No lean"
                      : r.lean === "over_4.5"
                        ? "Over 4.5"
                        : "Under 4.5"}
                  </td>
                  <td data-label="Confidence">
                    <span
                      style={{
                        ...confidenceStyle(r.confidence),
                        padding: "0.15rem 0.45rem",
                        borderRadius: "6px",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                      }}
                    >
                      {r.confidence}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
