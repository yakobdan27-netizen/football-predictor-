"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BatchEntryTab } from "./batch-entry-tab";
import { SavedBatchesTab } from "./saved-batches-tab";
import {
  ensureStorageInit,
  loadBatches,
  loadRecommendationSettings,
  loadCombinedOddsSettings,
  loadLearnerEnabled,
  updateLearnerStats,
  fetchTeamsQuality,
  getTeamsQualityCache,
  reloadBatchesFromServer,
} from "@/lib/prediction-log/storage";
import { batchNeedsResults } from "@/lib/prediction-log/scoring";
import { matchNeedsNamePairTrace } from "@/lib/prediction-log/result-trace";
import { matchNeedsApiDetailFill } from "@/lib/football-api/map-fixture-to-match";
import type { PredictionBatch, RecommendationSettings } from "@/lib/prediction-log/types";
import type { TeamsQualityStore } from "@/lib/prediction-log/teams-quality-types";

type TabId = "entry" | "saved";

const TABS: { id: TabId; label: string }[] = [
  { id: "entry", label: "New Batch" },
  { id: "saved", label: "Saved Batches" },
];

export function PredictionLogApp() {
  const [tab, setTab] = useState<TabId>("entry");
  const [batches, setBatches] = useState<PredictionBatch[]>([]);
  const [highlightBatchId, setHighlightBatchId] = useState<string | null>(null);
  const [recoSettings] = useState<RecommendationSettings>(() => loadRecommendationSettings());
  const [comboSettings] = useState(() => loadCombinedOddsSettings());
  const [learnerEnabled] = useState(() => loadLearnerEnabled());
  const [teamsQuality, setTeamsQuality] = useState<TeamsQualityStore | null>(
    () => getTeamsQualityCache()
  );
  const [loading, setLoading] = useState(true);
  const backgroundSyncAttempted = useRef(false);

  const refresh = useCallback(async () => {
    await ensureStorageInit();
    setBatches(loadBatches());
    updateLearnerStats();
    try {
      const tq = await fetchTeamsQuality();
      setTeamsQuality(tq);
    } catch {
      setTeamsQuality(getTeamsQualityCache());
    }
    setLoading(false);
  }, []);

  const handleSaved = useCallback(
    (batchId: string) => {
      void refresh().then(() => {
        setHighlightBatchId(batchId);
        setTab("saved");
      });
    },
    [refresh]
  );

  const handleViewBatch = useCallback((batchId: string) => {
    setHighlightBatchId(batchId);
    setTab("saved");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (loading || backgroundSyncAttempted.current) return;
    const all = loadBatches();
    const needsSync = all.some(
      (b: PredictionBatch) =>
        batchNeedsResults(b) ||
        b.matches.some(
          (m) => matchNeedsNamePairTrace(m) || matchNeedsApiDetailFill(m)
        )
    );
    if (!needsSync) return;
    backgroundSyncAttempted.current = true;
    void (async () => {
      try {
        await fetch("/api/sync-results", { method: "POST" });
        await reloadBatchesFromServer();
        setBatches(loadBatches());
        updateLearnerStats();
      } catch {
        /* non-blocking */
      }
    })();
  }, [loading]);

  if (loading) {
    return <p className="page-sub">Loading prediction log…</p>;
  }

  return (
    <div>
      <p className="page-sub" style={{ marginBottom: "1rem" }}>
        Enter predictions and match results here. For exports, tips, and batch comparisons, see{" "}
        <a href="/research-validation?tab=analysis" style={{ color: "var(--accent)" }}>
          Stats
        </a>
        .
      </p>

      <div
        className="chip-scroll"
        style={{ marginBottom: "1rem" }}
        role="tablist"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`chip${tab === t.id ? " selected" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "entry" && (
        <BatchEntryTab
          settings={recoSettings}
          comboSettings={comboSettings}
          learnerEnabled={learnerEnabled}
          teamsQuality={teamsQuality}
          onSaved={handleSaved}
          onViewBatch={handleViewBatch}
        />
      )}
      {tab === "saved" && (
        <SavedBatchesTab
          batches={batches}
          onUpdate={refresh}
          highlightBatchId={highlightBatchId}
          onHighlightConsumed={() => setHighlightBatchId(null)}
          learnerEnabled={learnerEnabled}
          recoSettings={recoSettings}
        />
      )}
    </div>
  );
}
