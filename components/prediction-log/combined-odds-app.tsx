"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { evaluateBatchCombos } from "@/lib/prediction-log/combo-selection";
import { upsertBatch } from "@/lib/prediction-log/storage";
import type { PredictionBatch, RecommendationTier } from "@/lib/prediction-log/types";
import { CombinedOddsBatchCard } from "./combined-odds-batch-card";
import { CombinedOddsSettingsPanel } from "./combined-odds-settings-panel";
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
        ...evaluateBatchCombos(batch, comboSettings, analysis, batches, teamsQuality, learnerStats, tier),
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
        <h1 className="page-title">Combined Odds</h1>
        <p className="page-sub">
          Best intra-match combo per game and batch combo accumulator — built on frozen recommendation
          score grids.{" "}
          <Link href="/recommendation" style={{ color: "var(--accent)" }}>
            Single-market picks →
          </Link>{" "}
          <Link href="/combined-odds-extended" style={{ color: "var(--accent)" }}>
            New combos (Section 2G) →
          </Link>
        </p>
      </div>

      <CombinedOddsSettingsPanel settings={comboSettings} onChange={setComboOddsSettings} />

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
        This choice is local to this page.
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
