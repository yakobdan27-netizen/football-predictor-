"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { evaluateBatchCombos } from "@/lib/prediction-log/combo-selection";
import { upsertBatch } from "@/lib/prediction-log/storage";
import type { PredictionBatch, RecommendationTier } from "@/lib/prediction-log/types";
import { CombinedOddsBatchCard } from "./combined-odds-batch-card";
import { CombinedOddsSettingsPanel } from "./combined-odds-settings-panel";
import { usePredictionLogData } from "./use-prediction-log-data";

const TIER_ORDER: Record<RecommendationTier, number> = {
  safe: 0,
  balanced: 1,
  aggressive: 2,
};

const TIER_FILTER_OPTIONS: Array<{ value: RecommendationTier | "all"; label: string }> = [
  { value: "all", label: "All tiers" },
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

  const [tierFilter, setTierFilter] = useState<RecommendationTier | "all">("all");
  const [savingOdds, setSavingOdds] = useState(false);

  const recommendedBatches = useMemo(
    () =>
      batches
        .filter((b) => b.batchKind === "recommended" && b.recommended)
        .filter((b) => tierFilter === "all" || b.recommendationTier === tierFilter)
        .sort((a, b) => {
          const tierDelta =
            TIER_ORDER[a.recommendationTier ?? "balanced"] -
            TIER_ORDER[b.recommendationTier ?? "balanced"];
          if (tierDelta !== 0) return tierDelta;
          return b.createdAt.localeCompare(a.createdAt);
        }),
    [batches, tierFilter]
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
          learnerStats
        ),
      })),
    [recommendedBatches, comboSettings, analysis, batches, teamsQuality, learnerStats]
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
          </Link>
        </p>
      </div>

      <CombinedOddsSettingsPanel settings={comboSettings} onChange={setComboOddsSettings} />

      <div style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {TIER_FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`btn ${tierFilter === opt.value ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setTierFilter(opt.value)}
          >
            {opt.label}
          </button>
        ))}
        {savingOdds ? (
          <span style={{ fontSize: "0.8125rem", color: "var(--muted)", alignSelf: "center" }}>
            Saving odds…
          </span>
        ) : null}
      </div>

      {evaluated.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0, color: "var(--muted)" }}>
            No recommended batches yet. Generate tiers on the{" "}
            <Link href="/recommendation">Recommendation</Link> page first.
          </p>
        </div>
      ) : (
        evaluated.map(({ batch, matches, accumulator }) => (
          <CombinedOddsBatchCard
            key={batch.id}
            batch={batch}
            matches={matches}
            accumulator={accumulator}
            onComboOddsChange={(matchId, odds) => void handleComboOddsChange(batch, matchId, odds)}
          />
        ))
      )}
    </div>
  );
}
