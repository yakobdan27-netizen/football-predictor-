"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { evaluateBatchCombos } from "@/lib/prediction-log/combo-selection";
import { ensureComboRecommendedShell } from "@/lib/prediction-log/prepare-batch-combos";
import { upsertBatch } from "@/lib/prediction-log/storage";
import type { PredictionBatch, RecommendationTier } from "@/lib/prediction-log/types";
import { BatchSelect } from "./batch-select";
import { CombinedOddsBatchCard } from "./combined-odds-batch-card";
import { CombinedOddsSettingsPanel } from "./combined-odds-settings-panel";
import { usePredictionLogData } from "./use-prediction-log-data";
import { usePreparedComboBatches } from "./use-prepared-combo-batches";
import { useSelectedBatchId } from "./use-selected-batch-id";

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
  const { preparedBatches, preparing } = usePreparedComboBatches(batches);

  const sortedEligible = useMemo(
    () =>
      [...preparedBatches].sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt) || b.date.localeCompare(a.date)
      ),
    [preparedBatches]
  );

  const { batchId, setBatchId, selected } = useSelectedBatchId(sortedEligible);

  const evaluated = useMemo(() => {
    if (!selected) return null;
    return {
      batch: selected,
      ...evaluateBatchCombos(
        selected,
        comboSettings,
        analysis,
        batches,
        teamsQuality,
        learnerStats,
        tier
      ),
    };
  }, [selected, comboSettings, analysis, batches, teamsQuality, learnerStats, tier]);

  if (!ready) {
    return <p className="page-sub">Loading…</p>;
  }

  async function handleComboOddsChange(batch: PredictionBatch, matchId: string, odds: number | "") {
    // Persist shell only when the batch has no recommended payload yet (manual batches).
    // Recommended batches keep their match list; we only patch comboOddsByMatch.
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
      {error && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <div style={{ marginBottom: "1rem" }}>
        <h1 className="page-title">Combined Odds</h1>
        <p className="page-sub">
          Combo picks for every match in the selected batch — probabilities from real club/hist
          samples only (insufficient-data legs excluded).{" "}
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
          alignItems: "center",
        }}
      >
        <BatchSelect
          batches={sortedEligible}
          value={batchId}
          onChange={setBatchId}
          emptyLabel="No batches"
        />
      </div>

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
          {savingOdds ? "Saving odds…" : "Preparing combo grids for all batch matches…"}
        </p>
      )}

      {sortedEligible.length === 0 ? (
        <p className="page-sub">
          No batches with matches yet. Save a batch from the{" "}
          <Link href="/prediction-log" style={{ color: "var(--accent)" }}>
            Prediction Log
          </Link>{" "}
          first.
        </p>
      ) : !evaluated ? (
        <p className="page-sub">Select a batch to view combined-odds results.</p>
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
