"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BatchMatchTable } from "./batch-match-table";
import { BatchSummaryStrip } from "./batch-summary-strip";
import { applyCorrectScoreCalibrationToMatch } from "@/lib/prediction-log/correct-score-learning";
import { batchScoredPct, marketsEnteredCount, scoreBatch } from "@/lib/prediction-log/scoring";
import { analyzeAllBatches } from "@/lib/prediction-log/batch-analysis";
import { scoreRecommendedBatchCombos } from "@/lib/prediction-log/combo-scoring";
import { loadCombinedOddsSettings } from "@/lib/prediction-log/combo-settings";
import { recomputeAnalysis } from "@/lib/prediction-log/analysis";
import { LOG_MARKET_MAP } from "@/lib/prediction-log/markets-config";
import {
  loadBatches,
  deleteBatch,
  saveAnalysis,
  upsertBatch,
  reloadBatchesFromServer,
  updateClubProfiles,
  updateLearnerStats,
  updateTeamCharacteristics,
  updateLeagueProfiles,
  refreshBatchLearnerRecommendation,
} from "@/lib/prediction-log/storage";
import type { LogMarketKey, PredictionBatch, RecommendationSettings } from "@/lib/prediction-log/types";

interface SavedBatchesTabProps {
  batches: PredictionBatch[];
  onUpdate: () => void;
  highlightBatchId?: string | null;
  onHighlightConsumed?: () => void;
  learnerEnabled?: boolean;
  recoSettings?: RecommendationSettings;
}

export function SavedBatchesTab({
  batches,
  onUpdate,
  highlightBatchId,
  onHighlightConsumed,
  learnerEnabled = false,
  recoSettings,
}: SavedBatchesTabProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PredictionBatch | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<"all" | "manual" | "recommended">("all");
  const [tierFilter, setTierFilter] = useState<"all" | "safe" | "balanced" | "aggressive">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "PENDING" | "SETTLED">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (highlightBatchId && batches.some((b) => b.id === highlightBatchId)) {
      const batch = batches.find((b) => b.id === highlightBatchId)!;
      setExpandedId(batch.id);
      setDraft(JSON.parse(JSON.stringify(batch)) as PredictionBatch);
      onHighlightConsumed?.();
    }
  }, [highlightBatchId, batches, onHighlightConsumed]);

  function openBatch(batch: PredictionBatch) {
    setExpandedId(batch.id);
    setDraft(JSON.parse(JSON.stringify(batch)) as PredictionBatch);
  }

  function summarizeRecommendedSettlement(batch: PredictionBatch, all: PredictionBatch[]): string {
    const legsTotal = batch.matches.reduce((sum, match) => sum + Object.keys(match.predictions).length, 0);
    const legsCorrect = batch.matches.reduce(
      (sum, match) => sum + Object.values(match.scored).filter((result) => result === "correct").length,
      0
    );
    const updatedAnalysis = recomputeAnalysis(all);
    const firstMarket = batch.matches.flatMap((match) => Object.keys(match.predictions) as LogMarketKey[])[0];
    const marketPct = firstMarket ? updatedAnalysis.marketAccuracy[firstMarket]?.pct ?? null : null;
    const sameSize = analyzeAllBatches(all).filter(
      (row) => row.batchWon != null && row.matchCount === batch.matches.length
    );
    const sizeWinRate =
      sameSize.length > 0
        ? Math.round((sameSize.filter((row) => row.batchWon).length / sameSize.length) * 100)
        : null;

    return [
      `This batch: ${legsCorrect}/${legsTotal} correct.`,
      firstMarket && marketPct != null
        ? `Your ${LOG_MARKET_MAP[firstMarket].label} accuracy is now ${marketPct}%.`
        : null,
      sizeWinRate != null
        ? `${batch.matches.length}-leg batches now win ${sizeWinRate}% for you.`
        : null,
    ]
      .filter(Boolean)
      .join(" ");
  }

  async function saveResults() {
    if (!draft) return;
    const calibratedDraft: PredictionBatch = {
      ...draft,
      matches: draft.matches.map((m) => applyCorrectScoreCalibrationToMatch(m)),
    };
    let scored = scoreBatch(calibratedDraft);
    if (scored.batchKind === "recommended") {
      const current = loadBatches();
      scored = scoreRecommendedBatchCombos(
        scored,
        current,
        recomputeAnalysis(current),
        loadCombinedOddsSettings()
      );
    }
    const entered = marketsEnteredCount(scored);
    const settled =
      entered.total > 0 && entered.scored === entered.total ? "SETTLED" : "PENDING";
    const projectedBatch: PredictionBatch = {
      ...scored,
      recommendationStatus: draft.batchKind === "recommended" ? settled : draft.recommendationStatus,
      settledAt:
        draft.batchKind === "recommended" && settled === "SETTLED"
          ? new Date().toISOString()
          : draft.settledAt,
    };
    const current = loadBatches();
    const projectedAll = current.some((batch) => batch.id === projectedBatch.id)
      ? current.map((batch) => (batch.id === projectedBatch.id ? projectedBatch : batch))
      : [projectedBatch, ...current];
    if (projectedBatch.batchKind === "recommended" && settled === "SETTLED") {
      projectedBatch.settlementSummary = summarizeRecommendedSettlement(projectedBatch, projectedAll);
    }

    try {
      await upsertBatch(projectedBatch);
      const all = loadBatches();
      saveAnalysis(recomputeAnalysis(all));
      updateClubProfiles(projectedBatch.id);
      updateLearnerStats();
      updateTeamCharacteristics();
      updateLeagueProfiles();

      let finalBatch = projectedBatch;
      if (learnerEnabled && recoSettings && projectedBatch.batchKind !== "recommended") {
        const refreshed = await refreshBatchLearnerRecommendation(projectedBatch.id, recoSettings);
        if (refreshed) finalBatch = refreshed;
      }

      setDraft(finalBatch);
      setSavedMsg(
        finalBatch.batchKind === "recommended" && finalBatch.settlementSummary
          ? finalBatch.settlementSummary
          : "Results saved."
      );
      onUpdate();
      setTimeout(() => setSavedMsg(null), 5000);
    } catch {
      setSavedMsg(null);
    }
  }

  async function syncFromApi() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/sync-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(expandedId ? { batchId: expandedId } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");

      await reloadBatchesFromServer();
      const all = loadBatches();
      saveAnalysis(recomputeAnalysis(all));
      updateClubProfiles();
      updateLearnerStats();
      updateTeamCharacteristics();
      updateLeagueProfiles();

      if (expandedId && draft) {
        const refreshed = all.find((b) => b.id === expandedId);
        if (refreshed) setDraft(JSON.parse(JSON.stringify(refreshed)) as PredictionBatch);
      }

      const parts = [
        `${data.matchesSynced ?? 0} match(es) updated`,
        `${data.matchesNotFound ?? 0} not found on API`,
      ];
      if (data.errors?.length) parts.push(data.errors.join("; "));
      setSyncMsg(parts.join(". "));
      onUpdate();
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const visibleBatches = batches.filter((batch) => {
    if (kindFilter !== "all" && (batch.batchKind ?? "manual") !== kindFilter) return false;
    if (tierFilter !== "all" && batch.recommendationTier !== tierFilter) return false;
    if (statusFilter !== "all" && batch.recommendationStatus !== statusFilter) return false;
    if (!search.trim()) return true;
    const haystack = [
      batch.batchName,
      batch.id,
      batch.recommendationId,
      batch.sourceBatchId,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });

  if (batches.length === 0) {
    return <p className="page-sub">No saved batches yet. Create one in New Batch.</p>;
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <div>
            <label className="label">Kind</label>
            <select className="select" value={kindFilter} onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}>
              <option value="all">All</option>
              <option value="manual">Manual</option>
              <option value="recommended">Recommended</option>
            </select>
          </div>
          <div>
            <label className="label">Tier</label>
            <select className="select" value={tierFilter} onChange={(e) => setTierFilter(e.target.value as typeof tierFilter)}>
              <option value="all">All</option>
              <option value="safe">Safe</option>
              <option value="balanced">Balanced</option>
              <option value="aggressive">Aggressive</option>
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
              <option value="all">All</option>
              <option value="PENDING">Pending</option>
              <option value="SETTLED">Settled</option>
            </select>
          </div>
          <div>
            <label className="label">Search ID / source</label>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="REC-... or source batch" />
          </div>
        </div>
        <div style={{ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={syncing}
            onClick={() => void syncFromApi()}
          >
            {syncing ? "Syncing…" : "Sync results from API"}
          </button>
          <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
            Fills empty actuals from api-sports.io by batch date and home/away team names.
            {expandedId ? " Syncing open batch only." : " Syncing all pending batches."}
          </span>
        </div>
        {syncMsg && (
          <p style={{ fontSize: "0.8125rem", color: "var(--accent)", marginTop: "0.5rem" }}>
            {syncMsg}
          </p>
        )}
      </div>

      {visibleBatches.length === 0 && (
        <p className="page-sub">No batches match the current filters.</p>
      )}

      {visibleBatches.map((batch) => {
        const pct = batchScoredPct(batch);
        const isOpen = expandedId === batch.id;
        const scoredLabel = pct != null ? "scored" : "not scored yet";

        return (
          <div key={batch.id} className="card" style={{ marginBottom: "0.75rem" }}>
            <button
              type="button"
              onClick={() => (isOpen ? setExpandedId(null) : openBatch(batch))}
              style={{
                width: "100%",
                textAlign: "left",
                background: "none",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <strong>{batch.batchName}</strong>
              <div style={{ fontSize: "0.875rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                {batch.league} · {batch.date} · {batch.matches.length} matches · {scoredLabel}
              </div>
              {batch.batchKind === "recommended" && (
                <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.35rem" }}>
                  <strong style={{ color: "inherit" }}>{batch.recommendationTier?.toUpperCase()}</strong>
                  {" · "}
                  {batch.recommendationStatus ?? "PENDING"}
                  {" · "}
                  {batch.recommendationId ?? batch.id}
                  {batch.sourceBatchId ? ` · source ${batch.sourceBatchId}` : ""}
                </div>
              )}
            </button>

            {isOpen && draft && draft.id === batch.id && (
              <div style={{ marginTop: "1rem" }}>
                {draft.recommended && (
                  <p style={{ fontSize: "0.875rem", marginBottom: "1rem" }}>
                    <Link href={`/analysis?batch=${batch.id}`} style={{ color: "var(--accent)" }}>
                      View comparison on Stats
                    </Link>
                  </p>
                )}

                <h3 style={{ fontSize: "1rem", margin: "0 0 0.75rem" }}>Enter results</h3>
                <BatchMatchTable
                  mode="result"
                  matches={draft.matches}
                  league={draft.league}
                  onChange={(matches) => setDraft({ ...draft, matches })}
                />
                <BatchSummaryStrip mode="result" batch={draft} />
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                  <button type="button" className="btn btn-primary" onClick={() => void saveResults()}>
                    Save results
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={deleting}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `Delete batch "${draft.batchName}"? This cannot be undone.`
                        )
                      ) {
                        return;
                      }
                      setDeleting(true);
                      try {
                        await deleteBatch(draft.id);
                        setExpandedId(null);
                        setDraft(null);
                        setSavedMsg(null);
                        onUpdate();
                      } finally {
                        setDeleting(false);
                      }
                    }}
                    style={{
                      background: "var(--danger)",
                      color: "#fff",
                      border: "none",
                    }}
                  >
                    {deleting ? "Deleting…" : "Delete batch"}
                  </button>
                </div>
                {savedMsg && draft.id === batch.id && (
                  <p style={{ color: "var(--accent)", marginTop: "0.5rem" }}>
                    {savedMsg}
                    {learnerEnabled && draft.batchKind !== "recommended"
                      ? " Recommendations refreshed."
                      : ""}
                  </p>
                )}
                {draft.settlementSummary && draft.batchKind === "recommended" && (
                  <p style={{ marginTop: "0.5rem", fontSize: "0.8125rem", color: "var(--muted)" }}>
                    {draft.settlementSummary}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
