"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { EXTENDED_COMBO_FAMILY_IDS } from "@/lib/prediction-log/combo-markets-config";
import { evaluateBatchCombos } from "@/lib/prediction-log/combo-selection";
import { upsertBatch } from "@/lib/prediction-log/storage";
import type { ComboMarketDef, PredictionBatch, RecommendationTier } from "@/lib/prediction-log/types";
import { CombinedOddsBatchCard } from "./combined-odds-batch-card";
import { usePredictionLogData } from "./use-prediction-log-data";

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

  const recommendedBatches = useMemo(
    () =>
      batches
        .filter((b) => b.batchKind === "recommended" && b.recommended)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [batches]
  );

  const evaluated = useMemo(
    () =>
      recommendedBatches.map((batch) => ({
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
    [recommendedBatches, comboSettings, analysis, batches, teamsQuality, learnerStats, tier]
  );

  if (!ready) {
    return <p className="page-sub">Loading…</p>;
  }

  async function handleComboOddsChange(batch: PredictionBatch, matchId: string, odds: number | "") {
    if (!batch.recommended) return;
    const comboOddsByMatch = { ...batch.recommended.comboOddsByMatch };
    if (odds === "" || !Number.isFinite(odds)) {
      delete comboOddsByMatch[matchId];
    } else {
      comboOddsByMatch[matchId] = odds;
    }
    const updated: PredictionBatch = {
      ...batch,
      recommended: { ...batch.recommended, comboOddsByMatch },
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
          Double Chance + BTTS Yes, and Double Chance + Total. Same score grid, adjustment chain, tier floors,
          and learning loop as the main combined-odds engine — just a different view.{" "}
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

      {savingOdds && (
        <p className="page-sub" style={{ marginBottom: "0.5rem" }}>
          Saving odds…
        </p>
      )}

      {evaluated.length === 0 ? (
        <p className="page-sub">
          No recommended batches yet. Generate one from the{" "}
          <Link href="/recommendation" style={{ color: "var(--accent)" }}>
            Recommendation
          </Link>{" "}
          page first.
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
