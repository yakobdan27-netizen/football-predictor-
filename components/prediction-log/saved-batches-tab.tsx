"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BatchMatchTable } from "./batch-match-table";
import { BatchSummaryStrip } from "./batch-summary-strip";
import { applyCorrectScoreCalibrationToMatch } from "@/lib/prediction-log/correct-score-learning";
import { batchScoredPct, marketsEnteredCount, scoreBatch, batchNeedsResults } from "@/lib/prediction-log/scoring";
import { analyzeAllBatches } from "@/lib/prediction-log/batch-analysis";
import { scoreRecommendedBatchCombos } from "@/lib/prediction-log/combo-scoring";
import { loadCombinedOddsSettings } from "@/lib/prediction-log/combo-settings";
import { recomputeAnalysis } from "@/lib/prediction-log/analysis";
import { LOG_MARKET_MAP } from "@/lib/prediction-log/markets-config";
import { batchLeagueDisplay, normalizeMatchLeagues } from "@/lib/prediction-log/match-league";
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
  const [autoFillUnavailable, setAutoFillUnavailable] = useState(false);
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [autoFilling, setAutoFilling] = useState(false);
  const [autoFillMsg, setAutoFillMsg] = useState<string | null>(null);
  const [autoFillAttempted, setAutoFillAttempted] = useState<Record<string, boolean>>({});
  const [livescoreFilling, setLivescoreFilling] = useState(false);
  const [conflicts, setConflicts] = useState<
    { matchId: string; field: string; label: string; current: number | string; apiValue: number | string }[]
  >([]);
  const [kindFilter, setKindFilter] = useState<"all" | "manual" | "recommended">("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "telegram" | "web">("all");
  const [tierFilter, setTierFilter] = useState<"all" | "safe" | "balanced" | "aggressive">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "PENDING" | "SETTLED">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (highlightBatchId && batches.some((b) => b.id === highlightBatchId)) {
      const batch = batches.find((b) => b.id === highlightBatchId)!;
      setExpandedId(batch.id);
      setDraft(JSON.parse(JSON.stringify(batch)) as PredictionBatch);
      onHighlightConsumed?.();
      void autoFillFromApi(batch.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per highlight
  }, [highlightBatchId, batches, onHighlightConsumed]);

  async function refreshDraftFromServer(batchId: string) {
    await reloadBatchesFromServer();
    const all = loadBatches();
    saveAnalysis(recomputeAnalysis(all));
    updateClubProfiles();
    updateLearnerStats();
    updateTeamCharacteristics();
    updateLeagueProfiles();
    const refreshed = all.find((b) => b.id === batchId);
    if (refreshed) {
      setDraft(JSON.parse(JSON.stringify(refreshed)) as PredictionBatch);
    }
    onUpdate();
  }

  /** Primary Auto-Fill: API-Football (server-only key). Never blocks manual entry.
   *  Pass batchId for one batch, or omit to fill every pending predicted batch. */
  async function autoFillFromApi(batchId?: string | null, opts?: { force?: boolean }) {
    const scopeKey = batchId ?? "__all__";
    if (!opts?.force && autoFillAttempted[scopeKey]) return;
    setAutoFillAttempted((prev) => ({ ...prev, [scopeKey]: true }));
    setAutoFilling(true);
    setSyncing(true);
    setAutoFillUnavailable(false);
    setAutoFillMsg(
      batchId
        ? "Auto-filling results from API-Football…"
        : "Auto-filling results for every pending batch…"
    );
    setSyncMsg(null);

    try {
      const res = await fetch("/api/sync-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batchId ? { batchId } : {}),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        unavailable?: boolean;
        banner?: string;
        matchesSynced?: number;
        matchesNotFound?: number;
        updatedBatches?: number;
        errors?: string[];
        conflicts?: {
          matchId: string;
          field: string;
          label: string;
          current: number | string;
          apiValue: number | string;
        }[];
      };

      if (!res.ok || data.unavailable) {
        setAutoFillUnavailable(true);
        setAutoFillMsg(
          data.banner ??
            "Auto-fill unavailable right now — enter results manually."
        );
        setSyncMsg(data.error ?? data.banner ?? "Auto-fill unavailable");
        return;
      }

      if (batchId) {
        await refreshDraftFromServer(batchId);
      } else {
        await reloadBatchesFromServer();
        const all = loadBatches();
        saveAnalysis(recomputeAnalysis(all));
        updateClubProfiles();
        updateLearnerStats();
        updateTeamCharacteristics();
        updateLeagueProfiles();
        if (expandedId) {
          const refreshed = all.find((b) => b.id === expandedId);
          if (refreshed) setDraft(JSON.parse(JSON.stringify(refreshed)) as PredictionBatch);
        }
        onUpdate();
      }
      setConflicts(data.conflicts ?? []);

      const parts = [
        `${data.updatedBatches ?? 0} batch(es) updated`,
        `${data.matchesSynced ?? 0} match(es) filled`,
        `${data.matchesNotFound ?? 0} not found on API`,
      ];
      if (data.conflicts?.length) {
        parts.push(`${data.conflicts.length} field(s) kept manual (use Replace to overwrite)`);
      }
      if (data.errors?.length) parts.push(data.errors.slice(0, 2).join("; "));
      setAutoFillMsg(parts.join(". "));
      setSyncMsg(parts.join(". "));
    } catch {
      setAutoFillUnavailable(true);
      setAutoFillMsg("Auto-fill unavailable right now — enter results manually.");
      setSyncMsg("Auto-fill unavailable right now — enter results manually.");
    } finally {
      setAutoFilling(false);
      setSyncing(false);
      setTimeout(() => setAutoFillMsg(null), 10000);
    }
  }

  /** Optional secondary fill via Livescore scrape. */
  async function fillFromLivescore(batchId: string) {
    setLivescoreFilling(true);
    setAutoFillMsg("Filling from Livescore…");

    let remaining: string[] = [];
    let filledTotal = 0;
    let failedTotal = 0;
    const errorParts: string[] = [];
    let rounds = 0;

    try {
      do {
        rounds++;
        const res = await fetch("/api/scrape-livescore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            batchId,
            matchIds: remaining.length ? remaining : undefined,
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          filled?: number;
          failed?: number;
          remaining?: string[];
          errors?: string[];
        };

        if (!res.ok) {
          throw new Error(data.error ?? "Livescore fill failed");
        }

        filledTotal += data.filled ?? 0;
        failedTotal += data.failed ?? 0;
        if (data.errors?.length) errorParts.push(...data.errors);
        remaining = data.remaining ?? [];

        await refreshDraftFromServer(batchId);
      } while (remaining.length > 0 && rounds < 15);

      const parts = [
        filledTotal > 0
          ? `Filled ${filledTotal} match(es) from Livescore`
          : "No matches needed Livescore fill",
      ];
      if (failedTotal > 0) parts.push(`${failedTotal} failed — enter manually`);
      if (remaining.length > 0) parts.push(`${remaining.length} still pending`);
      if (errorParts.length) parts.push(errorParts.slice(0, 2).join("; "));
      setAutoFillMsg(parts.join(". "));
    } catch (e) {
      setAutoFillMsg(
        e instanceof Error
          ? `${e.message} — enter results manually.`
          : "Livescore fill failed — enter results manually."
      );
    } finally {
      setLivescoreFilling(false);
      setTimeout(() => setAutoFillMsg(null), 8000);
    }
  }

  async function replaceConflictsWithApi() {
    if (!expandedId || !conflicts.length) return;
    const matchIds = [...new Set(conflicts.map((c) => c.matchId))];
    setSyncing(true);
    try {
      const res = await fetch("/api/sync-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: expandedId, replaceMatchIds: matchIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Replace failed");
      await refreshDraftFromServer(expandedId);
      setConflicts([]);
      setSyncMsg(`Replaced API values on ${data.matchesSynced ?? matchIds.length} match(es).`);
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Replace failed");
    } finally {
      setSyncing(false);
    }
  }

  function openBatch(batch: PredictionBatch) {
    setExpandedId(batch.id);
    setConflicts([]);
    setAutoFillUnavailable(false);
    const normalized: PredictionBatch = {
      ...batch,
      matches: normalizeMatchLeagues(batch.matches, batch.league),
    };
    setDraft(JSON.parse(JSON.stringify(normalized)) as PredictionBatch);
    void autoFillFromApi(batch.id);
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
    if (scored.batchKind === "recommended" && scored.recommended) {
      const current = loadBatches();
      scored = scoreRecommendedBatchCombos(
        scored,
        current,
        recomputeAnalysis(current),
        loadCombinedOddsSettings()
      );
      let evaluated = 0;
      let altWouldHaveWon = 0;
      for (const m of scored.matches) {
        if (m.primaryGrade?.result === "wrong" && m.altGrade?.result === "correct") {
          evaluated++;
          altWouldHaveWon++;
        } else if (m.altGrade?.result === "correct" || m.altGrade?.result === "wrong") {
          evaluated++;
        }
      }
      if (evaluated > 0) {
        scored = {
          ...scored,
          recommended: {
            ...scored.recommended!,
            alternativeSuggestionStats: { evaluated, altWouldHaveWon },
          },
        };
      }
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

      // Non-blocking audit log for AI learner pipeline (does not affect save)
      for (const m of projectedBatch.matches) {
        const hg = m.teamStats?.home?.goals;
        const ag = m.teamStats?.away?.goals;
        if (hg == null || ag == null) continue;
        const marketKey = Object.keys(m.predictions)[0];
        const pred = marketKey ? m.predictions[marketKey as LogMarketKey]?.prediction : undefined;
        void fetch("/api/manual-prediction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            batchId: projectedBatch.id,
            matchId: m.id,
            homeTeam: m.homeTeam,
            awayTeam: m.awayTeam,
            league: projectedBatch.league,
            predictedScore: pred,
            actualScore: `${hg}-${ag}`,
            confidence: marketKey
              ? m.predictions[marketKey as LogMarketKey]?.confidence
              : undefined,
          }),
        }).catch(() => {});
      }

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
    // Open batch → fill that batch; otherwise fill every pending predicted batch
    if (expandedId) {
      setAutoFillAttempted((prev) => {
        const next = { ...prev };
        delete next[expandedId];
        return next;
      });
      await autoFillFromApi(expandedId, { force: true });
      return;
    }
    setAutoFillAttempted((prev) => {
      const next = { ...prev };
      delete next["__all__"];
      return next;
    });
    await autoFillFromApi(null, { force: true });
  }

  async function syncLast5FromLivescore() {
    setBulkSyncing(true);
    setBulkMsg("Syncing last 5 results per league from Livescore…");
    let remaining: string[] | undefined;
    let scraped = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];
    let rounds = 0;

    try {
      do {
        rounds++;
        const res = await fetch("/api/livescore-bulk-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            maxLeagues: 1,
            leagues: remaining?.length ? remaining : undefined,
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          scraped?: number;
          skippedDuplicates?: number;
          failed?: number;
          doneLeagues?: string[];
          remainingLeagues?: string[];
          errors?: string[];
        };
        if (!res.ok) throw new Error(data.error ?? "Bulk sync failed");

        scraped += data.scraped ?? 0;
        skipped += data.skippedDuplicates ?? 0;
        failed += data.failed ?? 0;
        if (data.errors?.length) errors.push(...data.errors);
        remaining = data.remainingLeagues ?? [];

        await reloadBatchesFromServer();
        onUpdate();
      } while ((remaining?.length ?? 0) > 0 && rounds < 20);

      setBulkMsg(
        [
          `Bulk sync done: ${scraped} scraped`,
          skipped ? `${skipped} duplicates skipped` : null,
          failed ? `${failed} failed` : null,
          remaining?.length ? `${remaining.length} leagues left` : null,
          errors.length ? errors.slice(0, 2).join("; ") : null,
        ]
          .filter(Boolean)
          .join(". ")
      );
    } catch (e) {
      setBulkMsg(
        e instanceof Error
          ? `${e.message} — try again later.`
          : "Bulk sync failed — try again later."
      );
    } finally {
      setBulkSyncing(false);
      setTimeout(() => setBulkMsg(null), 10000);
    }
  }

  const visibleBatches = batches.filter((batch) => {
    if (kindFilter !== "all" && (batch.batchKind ?? "manual") !== kindFilter) return false;
    if (sourceFilter === "telegram" && batch.source !== "telegram") return false;
    if (sourceFilter === "web" && batch.source === "telegram") return false;
    if (tierFilter !== "all" && batch.recommendationTier !== tierFilter) return false;
    if (statusFilter !== "all" && batch.recommendationStatus !== statusFilter) return false;
    if (!search.trim()) return true;
    const haystack = [
      batch.batchName,
      batch.id,
      batch.recommendationId,
      batch.sourceBatchId,
      batch.ownerUserId,
      batch.source,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });

  const pendingTelegramResults = batches.filter(
    (b) => b.source === "telegram" && batchNeedsResults(b)
  ).length;

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
            <label className="label">Source</label>
            <select
              className="select"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)}
            >
              <option value="all">All</option>
              <option value="telegram">Telegram</option>
              <option value="web">Web</option>
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
        {pendingTelegramResults > 0 && (
          <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: "0.75rem 0 0" }}>
            {pendingTelegramResults} Telegram batch{pendingTelegramResults === 1 ? "" : "es"} pending
            results — Auto-Fill All includes them (feeds the global AI Learner).
          </p>
        )}
        <div style={{ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={syncing || bulkSyncing || livescoreFilling}
            onClick={() => void syncFromApi()}
            style={{ minHeight: 44, minWidth: 160, fontWeight: 700 }}
          >
            {syncing || autoFilling
              ? "Auto-filling…"
              : expandedId
                ? "Auto-Fill Results"
                : "Auto-Fill All Batches"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={livescoreFilling || syncing || !expandedId}
            onClick={() => expandedId && void fillFromLivescore(expandedId)}
            style={{ minHeight: 44 }}
          >
            {livescoreFilling ? "Livescore…" : "Fill from Livescore"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={bulkSyncing || syncing}
            onClick={() => void syncLast5FromLivescore()}
            style={{ minHeight: 44 }}
          >
            {bulkSyncing ? "Bulk syncing…" : "Sync last 5 (Livescore)"}
          </button>
          <span style={{ fontSize: "0.75rem", color: "var(--muted)", maxWidth: 420 }}>
            Auto-Fill uses API-Football for FT, HT, and corners on finished matches (every
            pending predicted batch including Telegram, or the open batch). Empty cells only —
            manual values are kept. After fill, scored outcomes update the global AI Learner for
            Recommendation and Telegram Get Decision. Livescore is optional fallback.
            {expandedId ? " Targeting the open batch." : " No batch open → fills all pending."}
          </span>
        </div>
        {autoFillUnavailable && (
          <div
            role="status"
            style={{
              marginTop: "0.75rem",
              padding: "0.75rem 1rem",
              borderRadius: 10,
              background: "rgba(249, 115, 22, 0.15)",
              color: "#c2410c",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            Auto-fill unavailable right now — enter results manually.
          </div>
        )}
        {conflicts.length > 0 && (
          <div
            style={{
              marginTop: "0.75rem",
              padding: "0.75rem 1rem",
              borderRadius: 10,
              background: "rgba(234, 179, 8, 0.15)",
              fontSize: "0.8125rem",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              ⚠ {conflicts.length} field(s) already had manual values (kept).
            </div>
            <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.1rem", color: "var(--muted)" }}>
              {conflicts.slice(0, 6).map((c) => (
                <li key={`${c.matchId}-${c.field}`}>
                  {c.label}: manual {String(c.current)} vs API {String(c.apiValue)}
                </li>
              ))}
              {conflicts.length > 6 && <li>…and {conflicts.length - 6} more</li>}
            </ul>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={syncing}
              onClick={() => void replaceConflictsWithApi()}
              style={{ minHeight: 40 }}
            >
              Replace with API values
            </button>
          </div>
        )}
        {syncMsg && (
          <p style={{ fontSize: "0.8125rem", color: "var(--accent)", marginTop: "0.5rem" }}>
            {syncMsg}
          </p>
        )}
        {bulkMsg && (
          <p style={{ fontSize: "0.8125rem", color: "var(--accent)", marginTop: "0.5rem" }}>
            {bulkMsg}
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
                {batchLeagueDisplay(batch)} · {batch.date} · {batch.matches.length} matches · {scoredLabel}
                {" · "}
                <span style={{ color: batch.source === "telegram" ? "var(--accent)" : "inherit" }}>
                  {batch.source === "telegram" ? "Telegram" : "Web"}
                </span>
                {batch.source === "telegram" && batch.ownerUserId
                  ? ` · owner ${batch.ownerUserId.slice(0, 8)}…`
                  : ""}
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
                {(autoFilling || livescoreFilling || autoFillMsg) && draft.id === batch.id && (
                  <p
                    style={{
                      fontSize: "0.8125rem",
                      color: "var(--accent)",
                      margin: "0 0 0.75rem",
                    }}
                  >
                    {autoFilling
                      ? "Auto-filling results from API-Football…"
                      : livescoreFilling
                        ? "Filling from Livescore…"
                        : autoFillMsg}
                  </p>
                )}
                <BatchMatchTable
                  mode="result"
                  matches={draft.matches}
                  defaultLeague={draft.league}
                  betterAltByMatch={
                    draft.recommended?.mathSnapshot?.betterAlternativeByMatch
                  }
                  onChange={(matches) => setDraft({ ...draft, matches })}
                />
                <BatchSummaryStrip mode="result" batch={draft} />
                <div className="batch-actions" style={{ marginTop: "0.75rem" }}>
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
