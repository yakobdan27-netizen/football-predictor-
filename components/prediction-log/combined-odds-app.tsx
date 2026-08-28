"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  evaluateBatchCombos,
  sortMatchCombosByProbability,
} from "@/lib/prediction-log/combo-selection";
import { ensureComboRecommendedShell } from "@/lib/prediction-log/prepare-batch-combos";
import { upsertBatch } from "@/lib/prediction-log/storage";
import type { PredictionBatch, RecommendationTier } from "@/lib/prediction-log/types";
import { AnalysisFixtureSourceControls } from "./analysis-fixture-source-controls";
import { CombinedOddsBatchCard } from "./combined-odds-batch-card";
import { CombinedOddsSettingsPanel } from "./combined-odds-settings-panel";
import { useComboFixtureBatch } from "./use-combo-fixture-batch";
import { usePredictionLogData } from "./use-prediction-log-data";

const TIER_OPTIONS: Array<{ value: RecommendationTier; label: string }> = [
  { value: "safe", label: "Extreme Safe" },
  { value: "balanced", label: "Balanced" },
  { value: "aggressive", label: "Aggressive" },
];

export function CombinedOddsApp() {
  const {
    ready,
    error,
    batches,
    analysis,
    comboSettings,
    teamsQuality,
    learnerStats,
    refresh,
    setComboOddsSettings,
  } = usePredictionLogData();

  const [tier, setTier] = useState<RecommendationTier>("balanced");
  const [savingOdds, setSavingOdds] = useState(false);
  const {
    fixtureSource,
    setFixtureSource,
    batchId,
    setBatchId,
    sortedEligible,
    activeBatch,
    weekend,
    loading: weekendLoading,
    preparing,
  } = useComboFixtureBatch();

  const evaluated = useMemo(() => {
    if (!activeBatch) return null;
    const result = evaluateBatchCombos(
      activeBatch,
      comboSettings,
      analysis,
      batches,
      teamsQuality,
      learnerStats,
      tier
    );
    return {
      batch: activeBatch,
      matches: sortMatchCombosByProbability(result.matches),
      accumulator: result.accumulator,
    };
  }, [
    activeBatch,
    comboSettings,
    analysis,
    batches,
    teamsQuality,
    learnerStats,
    tier,
  ]);

  if (!ready || (fixtureSource === "weekend" && weekendLoading)) {
    return <p className="page-sub">Loading…</p>;
  }

  async function handleComboOddsChange(batch: PredictionBatch, matchId: string, odds: number | "") {
    const base = batch.recommended ? batch : ensureComboRecommendedShell(batch);
    if (!base.recommended) return;
    const comboOddsByMatch = { ...base.recommended.comboOddsByMatch };
    if (odds === "" || !Number.isFinite(odds)) {
      delete comboOddsByMatch[matchId];
    } else {
      comboOddsByMatch[matchId] = odds;
    }
    const updated: PredictionBatch = {
      ...base,
      recommended: { ...base.recommended, comboOddsByMatch },
    };
    setSavingOdds(true);
    try {
      await upsertBatch(updated);
      await refresh();
    } finally {
      setSavingOdds(false);
    }
  }

  return (
    <div>
      {(error || (fixtureSource === "weekend" && weekend.error)) && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error ?? weekend.error}
        </div>
      )}

      <div style={{ marginBottom: "1rem" }}>
        <h1 className="page-title">Combined Odds</h1>
        <p className="page-sub">
          One combo pick per match from Weekend Picks (next 7 days) by default, ranked by combo
          probability (highest first). Probabilities from real club/hist samples only
          (insufficient-data legs excluded).{" "}
          <Link href="/recommendation" style={{ color: "var(--accent)" }}>
            Single-market picks →
          </Link>{" "}
          <Link href="/combo-centre?tab=extended-combo" style={{ color: "var(--accent)" }}>
            New combos (Section 2G) →
          </Link>
        </p>
      </div>

      <CombinedOddsSettingsPanel settings={comboSettings} onChange={setComboOddsSettings} />

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
          sortedBatches={sortedEligible}
          onRefresh={() => void weekend.refresh()}
          refreshing={weekend.refreshing}
        />
      </div>

      {fixtureSource === "weekend" &&
        weekend.warnings.map((w) => (
          <p
            key={w}
            style={{
              padding: "0.65rem 0.85rem",
              marginBottom: "0.75rem",
              background: "rgba(245, 158, 11, 0.12)",
              borderRadius: 8,
              fontSize: "0.8125rem",
            }}
          >
            {w}
          </p>
        ))}

      <div style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {TIER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={tier === opt.value ? "btn btn-primary" : "btn btn-secondary"}
            onClick={() => setTier(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "-0.5rem", marginBottom: "1rem" }}>
        Tier sets the accumulator floor and soft below-floor warnings. Per-match picks always use the top combo probability.
        This choice is local to this page.
      </p>

      {(savingOdds || preparing) && (
        <p className="page-sub" style={{ marginBottom: "0.5rem" }}>
          {savingOdds ? "Saving odds…" : "Preparing combo grids for batch matches…"}
        </p>
      )}

      {!activeBatch ? (
        <p className="page-sub">
          {fixtureSource === "weekend"
            ? "No Weekend Picks fixtures in the next 7 days."
            : sortedEligible.length === 0
              ? (
                <>
                  No batches with matches yet. Save a batch from the{" "}
                  <Link href="/prediction-log" style={{ color: "var(--accent)" }}>
                    Prediction Log
                  </Link>{" "}
                  first.
                </>
              )
              : "Select a saved batch to view combined-odds results."}
        </p>
      ) : !evaluated ? (
        <p className="page-sub">Preparing combo results…</p>
      ) : (
        <CombinedOddsBatchCard
          batch={evaluated.batch}
          tier={tier}
          matches={evaluated.matches}
          accumulator={evaluated.accumulator}
          onComboOddsChange={(matchId, odds) =>
            handleComboOddsChange(evaluated.batch, matchId, odds)
          }
        />
      )}
    </div>
  );
}
