"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FAMILY_LABELS } from "@/lib/slip-builder/families";
import {
  DEFAULT_SLIP_PREFERENCES,
  validateFamilySelection,
  type SlipBatchResult,
  type SlipPreferences,
} from "@/lib/slip-builder/types";
import { GuidedPreferences } from "./guided-preferences";

function pct(p: number): string {
  return `${(p * 100).toFixed(0)}%`;
}

function pct1(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

function defaultPrefs(): SlipPreferences {
  const now = new Date();
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    ...DEFAULT_SLIP_PREFERENCES,
    windowStart: now.toISOString().slice(0, 10),
    windowEnd: end.toISOString().slice(0, 10),
  };
}

export function SlipBuilderApp() {
  const [prefs, setPrefs] = useState<SlipPreferences>(defaultPrefs);
  const [panelOpen, setPanelOpen] = useState(true);
  const [mobileSheet, setMobileSheet] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<SlipBatchResult | null>(null);
  const [filteredOpen, setFilteredOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState<{
    slipIndex: number;
  } | null>(null);
  const [manualFixtureId, setManualFixtureId] = useState("");
  const [manualSelectionKey, setManualSelectionKey] = useState("");

  const conflictMessage = useMemo(() => {
    const v = validateFamilySelection(prefs.families);
    if (!v.ok) {
      return `Cannot use ${v.conflict[0]} and ${v.conflict[1]} together (conflict group ${v.groupId}).`;
    }
    return null;
  }, [prefs.families]);

  const generate = useCallback(
    async (excludeFixtureIds?: string[]) => {
      if (prefs.families.length !== 4) {
        setError("Select exactly four market families.");
        return;
      }
      if (conflictMessage) {
        setError(conflictMessage);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/slips/builder/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            preferences: prefs,
            excludeFixtureIds,
            persist: true,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Generation failed");
          return;
        }
        setBatch(data.batch as SlipBatchResult);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Generation failed");
      } finally {
        setLoading(false);
      }
    },
    [prefs, conflictMessage]
  );

  const onPrefsChange = (next: SlipPreferences) => {
    setPrefs(next);
  };

  // Changing engine-facing answers re-runs the optimiser (debounced).
  // Q9 userNote is record-only and must not trigger selection.
  const enginePrefsKey = useMemo(
    () =>
      JSON.stringify({
        families: prefs.families,
        legsPerSlip: prefs.legsPerSlip,
        pMin: prefs.pMin,
        competitions: prefs.competitions,
        windowStart: prefs.windowStart,
        windowEnd: prefs.windowEnd,
        maxLegsPerCompetition: prefs.maxLegsPerCompetition,
        excludeUncalibrated: prefs.excludeUncalibrated,
        correlationCeiling: prefs.correlationCeiling,
      }),
    [prefs]
  );

  useEffect(() => {
    if (prefs.families.length !== 4 || conflictMessage) return;
    const t = setTimeout(() => {
      void generate();
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by enginePrefsKey
  }, [enginePrefsKey, conflictMessage]);

  const applyAndGenerate = () => {
    void generate();
    setMobileSheet(false);
  };

  const regenerate = async () => {
    if (!batch) {
      void generate();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const id = Number(batch.batchId);
      if (Number.isFinite(id)) {
        const res = await fetch("/api/slips/builder/regenerate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromBatchId: id }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Regenerate failed");
          return;
        }
        setBatch(data.batch as SlipBatchResult);
      } else {
        const used = batch.slips.flatMap((s) => s.legs.map((l) => l.fixtureId));
        await generate([...new Set([...batch.fixtureExclusionIds, ...used])]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Regenerate failed");
    } finally {
      setLoading(false);
    }
  };

  const swap = async (slipIndex: number, legOrder: number) => {
    if (!batch) return;
    setLoading(true);
    try {
      const res = await fetch("/api/slips/builder/swap-leg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: batch.batchId,
          slipIndex,
          legOrder,
          batch,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Swap failed");
        return;
      }
      setBatch(data.batch as SlipBatchResult);
    } finally {
      setLoading(false);
    }
  };

  const submitManualAdd = async () => {
    if (!batch || manualOpen == null) return;
    const slip = batch.slips[manualOpen.slipIndex];
    if (!slip) return;
    setLoading(true);
    try {
      const res = await fetch("/api/slips/builder/manual-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: batch.batchId,
          slipIndex: manualOpen.slipIndex,
          batch,
          fixtureId: manualFixtureId,
          family: slip.family,
          selectionKey: manualSelectionKey,
          selectionLabel: manualSelectionKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Add failed");
        return;
      }
      setBatch(data.batch as SlipBatchResult);
      setManualOpen(null);
      setManualFixtureId("");
      setManualSelectionKey("");
    } finally {
      setLoading(false);
    }
  };

  const filteredReasons = useMemo(() => {
    if (!batch) return [] as Array<{ reason: string; count: number }>;
    const counts = new Map<string, number>();
    for (const f of batch.filtered) {
      for (const r of f.reasons) {
        counts.set(r, (counts.get(r) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);
  }, [batch]);

  return (
    <div className="page">
      <header style={{ marginBottom: 16 }}>
        <h1 className="page-title">Portfolio Slip Builder</h1>
        <p className="page-sub">
          Four slips ranked only on calibrated occurrence probability. No
          bookmaker comparison.
        </p>
      </header>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <span style={{ fontWeight: 600 }}>
          Batch #{batch?.batchNumber ?? "—"}
        </span>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          {batch?.generatedAt
            ? new Date(batch.generatedAt).toLocaleString()
            : "—"}
        </span>
        <button
          type="button"
          className="btn"
          onClick={() => setMobileSheet(true)}
          style={{ marginLeft: "auto" }}
        >
          Preferences
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={loading || Boolean(conflictMessage)}
          onClick={applyAndGenerate}
        >
          {loading ? "Building…" : "Build batch"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={loading || !batch}
          onClick={() => void regenerate()}
        >
          Regenerate
        </button>
      </div>

      <div className="slip-prefs-panel">
        <GuidedPreferences
          prefs={prefs}
          onChange={onPrefsChange}
          open={panelOpen}
          onToggle={() => setPanelOpen((o) => !o)}
          conflictMessage={conflictMessage}
        />
      </div>

      {mobileSheet && (
        <div
          role="dialog"
          aria-modal
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 80,
            display: "flex",
            alignItems: "flex-end",
          }}
          onClick={() => setMobileSheet(false)}
        >
          <div
            style={{
              background: "var(--bg, #fff)",
              width: "100%",
              maxHeight: "85vh",
              overflow: "auto",
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <GuidedPreferences
              prefs={prefs}
              onChange={onPrefsChange}
              open
              onToggle={() => setMobileSheet(false)}
              conflictMessage={conflictMessage}
            />
            <button
              type="button"
              className="btn primary"
              style={{ width: "100%", marginTop: 12 }}
              onClick={applyAndGenerate}
            >
              Apply & rebuild
            </button>
          </div>
        </div>
      )}

      {error && (
        <p style={{ color: "var(--danger, #b91c1c)", marginBottom: 12 }}>
          {error}
        </p>
      )}

      {batch?.partialReason && (
        <p
          className="card"
          style={{ marginBottom: 12, color: "var(--muted)", fontSize: 14 }}
        >
          {batch.partialReason}
        </p>
      )}

      <div style={{ display: "grid", gap: 16 }}>
        {batch?.slips.map((slip) => (
          <section key={slip.slipIndex} className="card">
            <header
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "baseline",
                marginBottom: 10,
              }}
            >
              <h2 style={{ margin: 0, fontSize: 18 }}>
                SLIP {slip.slipIndex + 1} —{" "}
                {FAMILY_LABELS[slip.family].toUpperCase()}
              </h2>
              {slip.provisional && (
                <span
                  style={{
                    fontSize: 12,
                    background: "rgba(245,158,11,0.2)",
                    padding: "2px 8px",
                    borderRadius: 4,
                  }}
                >
                  provisional
                </span>
              )}
              {slip.manuallyAltered && (
                <span
                  style={{
                    fontSize: 12,
                    background: "rgba(59,130,246,0.15)",
                    padding: "2px 8px",
                    borderRadius: 4,
                  }}
                >
                  manually altered
                </span>
              )}
            </header>
            <p style={{ margin: "0 0 4px", fontSize: 14 }}>
              Independence estimate (upper bound):{" "}
              <strong>{pct(slip.independenceUpper)}</strong>
            </p>
            <p style={{ margin: "0 0 4px", fontSize: 14 }}>
              Correlation-adjusted: {pct(slip.bandLower)} –{" "}
              {pct(slip.bandUpper)}
            </p>
            <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 13 }}>
              mean ρ {slip.meanRho.toFixed(2)}
            </p>

            <div style={{ display: "grid", gap: 10 }}>
              {slip.legs.map((leg, i) => (
                <article
                  key={`${leg.fixtureId}-${leg.selectionKey}-${i}`}
                  style={{
                    border: "1px solid var(--border, #e5e7eb)",
                    borderRadius: 8,
                    padding: 12,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {leg.homeTeam} vs {leg.awayTeam}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>
                    {leg.competition} · {leg.kickoffIso.slice(0, 10)}
                  </div>
                  <div style={{ marginTop: 6 }}>{leg.selectionLabel}</div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 10,
                      marginTop: 8,
                      fontSize: 13,
                    }}
                  >
                    <span>
                      <strong>{pct1(leg.pCalibrated)}</strong> calibrated
                    </span>
                    <span style={{ color: "var(--muted)" }}>
                      (raw {pct1(leg.pRaw)})
                    </span>
                    <span>n = {Math.round(leg.nEffective)}</span>
                    <span
                      style={{
                        color: leg.calibrated ? "#15803d" : "#b45309",
                      }}
                    >
                      ●{leg.calibrated ? "calibrated" : "uncalibrated"}
                    </span>
                    <span style={{ color: "var(--muted)" }}>
                      {leg.selectionSource}
                    </span>
                  </div>
                  {leg.warning && (
                    <p style={{ color: "#b45309", fontSize: 12, marginTop: 6 }}>
                      {leg.warning}
                    </p>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: 12 }}
                      disabled={loading}
                      onClick={() => void swap(slip.slipIndex, i)}
                    >
                      Swap leg
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <button
              type="button"
              className="btn"
              style={{ marginTop: 10, fontSize: 13 }}
              onClick={() => setManualOpen({ slipIndex: slip.slipIndex })}
            >
              Manual add
            </button>
          </section>
        ))}
      </div>

      {batch && (
        <section className="card" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn"
            onClick={() => setFilteredOpen((o) => !o)}
            style={{ width: "100%", textAlign: "left" }}
          >
            {filteredOpen ? "▾" : "▸"} {batch.filtered.length} legs filtered out
            — view reasons
          </button>
          {filteredOpen && (
            <div style={{ marginTop: 12, fontSize: 13 }}>
              {filteredReasons.length === 0 ? (
                <p style={{ color: "var(--muted)" }}>No exclusions recorded.</p>
              ) : (
                <ul>
                  {filteredReasons.map((r) => (
                    <li key={r.reason}>
                      {r.reason}: {r.count}
                    </li>
                  ))}
                </ul>
              )}
              <details style={{ marginTop: 8 }}>
                <summary>Sample excluded legs</summary>
                <ul>
                  {batch.filtered.slice(0, 40).map((f, i) => (
                    <li key={`${f.fixtureId}-${f.selectionKey}-${i}`}>
                      {f.homeTeam} vs {f.awayTeam} · {f.selectionLabel} ·{" "}
                      {f.reasons.join(", ")}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
        </section>
      )}

      {manualOpen && (
        <div
          role="dialog"
          aria-modal
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 90,
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => setManualOpen(null)}
        >
          <div
            className="card"
            style={{ maxWidth: 420, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Manual add (never blocked)</h3>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              Failing gates still adds the leg and marks the slip as manually
              altered.
            </p>
            <label style={{ display: "block", marginBottom: 8 }}>
              Fixture id
              <input
                value={manualFixtureId}
                onChange={(e) => setManualFixtureId(e.target.value)}
                style={{ width: "100%" }}
                placeholder="api:123 or match:…"
              />
            </label>
            <label style={{ display: "block", marginBottom: 8 }}>
              Selection key
              <input
                value={manualSelectionKey}
                onChange={(e) => setManualSelectionKey(e.target.value)}
                style={{ width: "100%" }}
                placeholder="home / over_2.5 / yes …"
              />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn primary"
                onClick={() => void submitManualAdd()}
              >
                Add
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setManualOpen(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
