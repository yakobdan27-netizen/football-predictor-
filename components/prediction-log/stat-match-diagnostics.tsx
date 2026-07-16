"use client";

import { useEffect, useMemo, useState } from "react";
import { CorrectScorePanel } from "./correct-score-panel";
import { BayesianMatchPanel } from "./bayesian-match-panel";
import { computeDixonColes } from "@/lib/prediction-log/statistics-engine";
import { buildInferenceFeatures } from "@/lib/prediction-log/training-data";
import { predictMlOutcome } from "@/lib/prediction-log/ml-engine";
import { computePStat, shrinkPStat } from "@/lib/prediction-log/stat-probability";
import { computeLeagueBaselines } from "@/lib/prediction-log/league-baselines";
import { fetchClubRecord, retrainMlModel } from "@/lib/prediction-log/storage";
import type { AnalysisHistory, LogMarketKey, LogMatch, PredictionBatch } from "@/lib/prediction-log/types";
import type { ClubRecord } from "@/lib/prediction-log/club-record-types";
import type { MlClassifierStore } from "@/lib/prediction-log/ml-model-store";
import type { TeamsQualityStore } from "@/lib/prediction-log/teams-quality-types";

interface StatMatchDiagnosticsProps {
  batches: PredictionBatch[];
  analysis: AnalysisHistory | null;
  teamsQuality: TeamsQualityStore | null;
  mlClassifier: MlClassifierStore | null;
  /** Prefer this batch id / recommendationId when present (deep-link). */
  initialBatchId?: string | null;
}

export function StatMatchDiagnostics({
  batches,
  analysis,
  teamsQuality,
  mlClassifier,
  initialBatchId,
}: StatMatchDiagnosticsProps) {
  const resolvedInitial =
    batches.find((b) => b.id === initialBatchId || b.recommendationId === initialBatchId)?.id ??
    batches[0]?.id ??
    "";
  const [batchId, setBatchId] = useState(resolvedInitial);
  const [matchId, setMatchId] = useState("");
  const [homeRecord, setHomeRecord] = useState<ClubRecord | null>(null);
  const [awayRecord, setAwayRecord] = useState<ClubRecord | null>(null);
  const [retraining, setRetraining] = useState(false);
  const [retrainMsg, setRetrainMsg] = useState<string | null>(null);
  const [modelInfo, setModelInfo] = useState(mlClassifier);

  useEffect(() => {
    if (!initialBatchId) return;
    const match =
      batches.find((b) => b.id === initialBatchId || b.recommendationId === initialBatchId)?.id ??
      null;
    if (match && match !== batchId) setBatchId(match);
  }, [initialBatchId, batches, batchId]);

  const batch = batches.find((b) => b.id === batchId) ?? null;
  const matches = batch?.matches ?? [];
  const match = matches.find((m) => m.id === matchId) ?? matches[0] ?? null;

  const leagueBaselines = useMemo(() => computeLeagueBaselines(batches), [batches]);

  const diagnostics = useMemo(() => {
    if (!batch || !match) return null;
    const pickEntry = Object.entries(match.predictions)[0];
    if (!pickEntry) return null;
    const [marketKey, pick] = pickEntry;
    if (!pick) return null;

    const dc = computeDixonColes(
      homeRecord,
      awayRecord,
      batch.league,
      marketKey as LogMarketKey,
      pick.prediction,
      pick.line,
      leagueBaselines
    );
    const features = buildInferenceFeatures(
      match,
      homeRecord,
      awayRecord,
      analysis,
      teamsQuality,
      {}
    );
    const mlProbs = predictMlOutcome(modelInfo, features);
    const { pDc, pMl, pStat } = computePStat(
      dc,
      mlProbs,
      marketKey as LogMarketKey,
      pick.prediction,
      pick.line
    );
    const minSample = Math.min(
      homeRecord?.statMetadata?.sample_size ?? 0,
      awayRecord?.statMetadata?.sample_size ?? 0
    );
    const shrunk = shrinkPStat(pStat, minSample);

    return { dc, mlProbs, pDc, pMl, pStat: shrunk, pick, marketKey };
  }, [batch, match, homeRecord, awayRecord, leagueBaselines, analysis, teamsQuality, modelInfo]);

  useEffect(() => {
    if (!match) return;
    void (async () => {
      if (match.homeClubId) setHomeRecord(await fetchClubRecord(match.homeClubId));
      else setHomeRecord(null);
      if (match.awayClubId) setAwayRecord(await fetchClubRecord(match.awayClubId));
      else setAwayRecord(null);
    })();
  }, [match?.id, match?.homeClubId, match?.awayClubId]);

  async function handleRetrain() {
    setRetraining(true);
    setRetrainMsg(null);
    try {
      const result = await retrainMlModel();
      setRetrainMsg(
        `Retrained on ${result.trainingRows} rows using ${result.algorithm} (${result.sampleCount} samples).`
      );
      const res = await fetch("/api/ml-model");
      const data = await res.json();
      if (res.ok) setModelInfo(data.classifier);
    } catch (e) {
      setRetrainMsg(e instanceof Error ? e.message : "Retrain failed");
    } finally {
      setRetraining(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: "1.5rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "1rem" }}>Statistical model diagnostics</h3>
        <button type="button" className="btn btn-secondary" onClick={() => void handleRetrain()} disabled={retraining}>
          {retraining ? "Retraining…" : "Retrain now"}
        </button>
      </div>

      {retrainMsg && (
        <p style={{ fontSize: "0.8125rem", color: "var(--muted)", marginBottom: "0.75rem" }}>{retrainMsg}</p>
      )}

      {modelInfo && (
        <p style={{ fontSize: "0.8125rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
          Active model: {modelInfo.algorithm} · {modelInfo.sampleCount} training samples
        </p>
      )}

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <select
          className="select"
          value={batchId}
          onChange={(e) => {
            setBatchId(e.target.value);
            setMatchId("");
          }}
        >
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.batchName} ({b.date})
            </option>
          ))}
        </select>
        <select
          className="select"
          value={match?.id ?? ""}
          onChange={(e) => {
            setMatchId(e.target.value);
          }}
        >
          {matches.map((m) => (
            <option key={m.id} value={m.id}>
              {m.homeTeam} vs {m.awayTeam}
            </option>
          ))}
        </select>
      </div>

      {!diagnostics ? (
        <p style={{ color: "var(--muted)" }}>Select a batch and match with at least one prediction.</p>
      ) : (
        <div style={{ display: "grid", gap: "1rem" }}>
          <div className="stat-grid">
            <div>
              <div className="stat-label">λ home</div>
              <div className="stat-value">{diagnostics.dc.lambdaHome.toFixed(2)}</div>
            </div>
            <div>
              <div className="stat-label">λ away</div>
              <div className="stat-value">{diagnostics.dc.lambdaAway.toFixed(2)}</div>
            </div>
            <div>
              <div className="stat-label">P_dc</div>
              <div className="stat-value">{diagnostics.pDc}%</div>
            </div>
            <div>
              <div className="stat-label">P_ml</div>
              <div className="stat-value">{diagnostics.pMl}%</div>
            </div>
            <div>
              <div className="stat-label">P_stat</div>
              <div className="stat-value">{diagnostics.pStat}%</div>
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>ML outcome probabilities</div>
            <div style={{ fontSize: "0.875rem" }}>
              Home {(diagnostics.mlProbs.home * 100).toFixed(1)}% · Draw{" "}
              {(diagnostics.mlProbs.draw * 100).toFixed(1)}% · Away{" "}
              {(diagnostics.mlProbs.away * 100).toFixed(1)}%
            </div>
          </div>

          <CorrectScorePanel grid={diagnostics.dc.scoreGrid} label="Correct score (live estimate)" />

          {match && batch && (
            <BayesianMatchPanel
              match={match}
              league={batch.league}
              homeRecord={homeRecord}
              awayRecord={awayRecord}
              leagueBaselines={leagueBaselines}
              teamsQuality={teamsQuality}
              lambdaDcHome={diagnostics.dc.lambdaHome}
              lambdaDcAway={diagnostics.dc.lambdaAway}
            />
          )}
        </div>
      )}
    </div>
  );
}
