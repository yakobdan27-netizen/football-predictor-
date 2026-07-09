"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  generateTieredRecommendationBatchesAsync,
  saveLuckyNumbers,
  upsertBatch,
} from "@/lib/prediction-log/storage";
import { parseLuckyNumbersInput, formatLuckyNumbers } from "@/lib/prediction-log/lucky-numbers";
import type { PredictionBatch, RecommendationTier } from "@/lib/prediction-log/types";
import { RecommendationSettingsPanel } from "./recommendation-settings-panel";
import { RecommendationBatchSummaryCard } from "./recommendation-batch-summary-card";
import { usePredictionLogData } from "./use-prediction-log-data";

const TIER_ORDER: Record<RecommendationTier, number> = {
  safe: 0,
  balanced: 1,
  aggressive: 2,
};

function batchHasPredictions(batch: PredictionBatch): boolean {
  return batch.matches.some((m) => Object.keys(m.predictions).length > 0);
}

export function RecommendationApp() {
  const {
    ready,
    error,
    batches,
    luckyNumbers,
    recoSettings,
    learnerEnabled,
    setSettings,
    setLearner,
    refresh,
  } = usePredictionLogData();

  const eligible = useMemo(
    () => batches.filter((batch) => batch.batchKind !== "recommended" && batchHasPredictions(batch)),
    [batches]
  );

  const recommendedBatches = useMemo(
    () =>
      batches
        .filter((b) => b.batchKind === "recommended" && b.recommended)
        .sort((a, b) => {
          const tierDelta =
            TIER_ORDER[a.recommendationTier ?? "balanced"] -
            TIER_ORDER[b.recommendationTier ?? "balanced"];
          if (tierDelta !== 0) return tierDelta;
          return b.createdAt.localeCompare(a.createdAt);
        }),
    [batches]
  );

  const [selectedId, setSelectedId] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [luckyInput, setLuckyInput] = useState(
    () => formatLuckyNumbers(luckyNumbers?.numbers ?? [])
  );
  const [lastGeneratedIds, setLastGeneratedIds] = useState<string[]>([]);

  const effectiveId = selectedId || eligible[0]?.id || "";

  if (!ready) {
    return <p className="page-sub">Loading…</p>;
  }

  async function handleGenerate() {
    const batch = batches.find((b) => b.id === effectiveId);
    if (!batch) return;
    setGenerating(true);
    try {
      const nums = parseLuckyNumbersInput(luckyInput);
      saveLuckyNumbers(nums);
      const tierBatches = await generateTieredRecommendationBatchesAsync(
        batch,
        recoSettings,
        learnerEnabled,
        nums
      );
      for (const tierBatch of tierBatches) {
        await upsertBatch(tierBatch);
      }
      const savedIds = tierBatches.map((tb) => tb.id);
      setLastGeneratedIds(savedIds);
      await refresh();
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      {error && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <div
        className="card"
        style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={learnerEnabled}
            onChange={(e) => setLearner(e.target.checked)}
          />
          Use AI Learner for recommendations
        </label>
      </div>

      <RecommendationSettingsPanel settings={recoSettings} onChange={setSettings} />

      <div className="card" style={{ marginBottom: "1rem" }}>
        <label className="label">Source batch</label>
        {eligible.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: "0.875rem", margin: 0 }}>
            No saved batches with predictions. Enter picks on the{" "}
            <Link href="/prediction-log" style={{ color: "var(--accent)" }}>
              Prediction Log
            </Link>{" "}
            first.
          </p>
        ) : (
          <select
            className="select"
            value={effectiveId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {eligible.map((b) => (
              <option key={b.id} value={b.id}>
                {b.batchName} — {b.date} ({b.matches.length} matches)
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <label className="label">Lucky numbers (optional)</label>
        <input
          className="input"
          placeholder="e.g. 7, 13, 23"
          value={luckyInput}
          onChange={(e) => setLuckyInput(e.target.value)}
          style={{ maxWidth: "280px" }}
        />
        <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: "0.35rem 0 0" }}>
          Comma-separated. Influences selection notes when odds decimals match.
        </p>
      </div>

      <button
        type="button"
        className="btn btn-primary"
        disabled={!effectiveId || generating}
        onClick={() => void handleGenerate()}
        style={{ marginBottom: "1rem" }}
      >
        {generating ? "Generating…" : "Generate Recommendation"}
      </button>

      {lastGeneratedIds.length > 0 && (
        <p style={{ margin: "0 0 1rem", fontSize: "0.8125rem", color: "var(--muted)" }}>
          Saved: {lastGeneratedIds.join(", ")}. Settle results on the{" "}
          <Link href="/prediction-log" style={{ color: "var(--accent)" }}>
            Prediction Log
          </Link>
          .
        </p>
      )}

      <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Recommendation batches</h3>
      {recommendedBatches.length === 0 ? (
        <p className="page-sub" style={{ margin: 0 }}>
          No recommendation batches yet. Generate from a source batch above.
        </p>
      ) : (
        <div style={{ display: "grid", gap: "1rem" }}>
          {recommendedBatches.map((batch) => (
            <RecommendationBatchSummaryCard key={batch.id} batch={batch} />
          ))}
        </div>
      )}
    </div>
  );
}
