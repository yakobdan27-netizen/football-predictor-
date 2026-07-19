"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { EXTENDED_COMBO_FAMILY_IDS } from "@/lib/prediction-log/combo-markets-config";
import { evaluateBatchCombos } from "@/lib/prediction-log/combo-selection";
import { ensureComboRecommendedShell } from "@/lib/prediction-log/prepare-batch-combos";
import { upsertBatch } from "@/lib/prediction-log/storage";
import type { ComboMarketDef, PredictionBatch, RecommendationTier } from "@/lib/prediction-log/types";
import { CombinedOddsBatchCard } from "./combined-odds-batch-card";
import { usePredictionLogData } from "./use-prediction-log-data";
import { usePreparedComboBatches } from "./use-prepared-combo-batches";

const TIER_OPTIONS: Array<{ value: RecommendationTier; label: string }> = [
  { value: "safe", label: "Extreme Safe" },
  { value: "balanced", label: "Balanced" },
  { value: "aggressive", label: "Aggressive" },
];

const EXTENDED_FAMILY_SET = new Set(EXTENDED_COMBO_FAMILY_IDS);
const extendedComboFilter = (combo: ComboMarketDef) => EXTENDED_FAMILY_SET.has(combo.id);

export function CombinedOddsExtendedApp() {
  const { ready, error, batches, analysis, comboSettings, teamsQuality, learnerStats, refresh } =
    usePredictionLogData();

  const [tier, setTier] = useState<RecommendationTier>("balanced");
  const [savingOdds, setSavingOdds] = useState(false);
  const { preparedBatches, preparing } = usePreparedComboBatches(batches);

  const evaluated = useMemo(
    () =>
      preparedBatches.map((batch) => ({
        batch,
        ...evaluateBatchCombos(
          batch,
          comboSettings,
          analysis,
          batches,
          teamsQuality,
          learnerStats,
          tier,
          extendedComboFilter
        ),
      })),
    [preparedBatches, comboSettings, analysis, batches, teamsQuality, learnerStats, tier]
  );

  if (!ready) {
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
      {error && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <div style={{ marginBottom: "1rem" }}>
        <h1 className="page-title">Extended Combined Odds</h1>
        <p className="page-sub">
          Only the four new combo families: Result + Total, At Least One Team Not To Score (BTTS No) + Total,
          Double Chance + BTTS Yes, and Double Chance + Total. Every match from every saved batch is included.{" "}
          <Link href="/combined-odds" style={{ color: "var(--accent)" }}>
            ← Original combos
          </Link>
        </p>
      </div>

      <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "1rem" }}>
        Edit the enabled-combo checklist (including these new ones) on the{" "}
        <Link href="/settings" style={{ color: "var(--accent)" }}>
          Settings
        </Link>{" "}
        page.
      </p>

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
        Tier sets the minimum combo probability that qualifies for a pick and the batch accumulator floor.
        This choice is local to this page (independent of the main Combined Odds page).
      </p>

      {(savingOdds || preparing) && (
        <p className="page-sub" style={{ marginBottom: "0.5rem" }}>
          {savingOdds ? "Saving odds…" : "Preparing combo grids for all batch matches…"}
        </p>
      )}

      {evaluated.length === 0 ? (
        <p className="page-sub">
          No batches with matches yet. Save a batch from the{" "}
          <Link href="/prediction-log" style={{ color: "var(--accent)" }}>
            Prediction Log
          </Link>{" "}
          first.
        </p>
      ) : (
        evaluated.map(({ batch, matches, accumulator }) => (
          <CombinedOddsBatchCard
            key={batch.id}
            batch={batch}
            tier={tier}
            matches={matches}
            accumulator={accumulator}
            onComboOddsChange={(matchId, odds) => handleComboOddsChange(batch, matchId, odds)}
          />
        ))
      )}
    </div>
  );
}
