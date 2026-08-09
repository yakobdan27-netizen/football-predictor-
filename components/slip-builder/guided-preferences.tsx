"use client";

import { SLIP_COMPETITIONS } from "@/lib/slip-builder/batch-pool";
import { FAMILY_LABELS } from "@/lib/slip-builder/families";
import {
  CONFLICT_GROUPS,
  MARKET_FAMILY_IDS,
  conflictGroupOf,
  validateFamilySelection,
  type MarketFamilyId,
  type SlipPreferences,
} from "@/lib/slip-builder/types";

type Props = {
  prefs: SlipPreferences;
  onChange: (next: SlipPreferences) => void;
  open: boolean;
  onToggle: () => void;
  conflictMessage: string | null;
};

export function GuidedPreferences({
  prefs,
  onChange,
  open,
  onToggle,
  conflictMessage,
}: Props) {
  const set = <K extends keyof SlipPreferences>(
    key: K,
    value: SlipPreferences[K]
  ) => onChange({ ...prefs, [key]: value });

  const onToggleFamily = (id: MarketFamilyId) => {
    if (prefs.families.includes(id)) {
      set(
        "families",
        prefs.families.filter((f) => f !== id)
      );
      return;
    }
    if (prefs.families.length >= 4) return;
    const group = conflictGroupOf(id);
    if (
      group &&
      prefs.families.some((f) => conflictGroupOf(f) === group)
    ) {
      // Block: same conflict group already represented
      return;
    }
    const next = [...prefs.families, id];
    const v = validateFamilySelection(next);
    if (!v.ok) return;
    set("families", next);
  };

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <button
        type="button"
        className="btn"
        onClick={onToggle}
        style={{ width: "100%", textAlign: "left" }}
        aria-expanded={open}
      >
        Guided preferences {open ? "▾" : "▸"}
      </button>

      {open && (
        <div style={{ display: "grid", gap: 16, marginTop: 14 }}>
          <fieldset>
            <legend style={{ fontWeight: 600, marginBottom: 8 }}>
              Q1 — Which four market families? (max one per conflict group)
            </legend>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 8,
              }}
            >
              {MARKET_FAMILY_IDS.map((id) => {
                const checked = prefs.families.includes(id);
                const group = conflictGroupOf(id);
                const groupTaken =
                  !checked &&
                  !!group &&
                  prefs.families.some((f) => conflictGroupOf(f) === group);
                const disabled =
                  (!checked && prefs.families.length >= 4) || groupTaken;
                return (
                  <label
                    key={id}
                    style={{
                      display: "flex",
                      gap: 6,
                      alignItems: "flex-start",
                      opacity: disabled ? 0.45 : 1,
                      fontSize: 13,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={Boolean(disabled)}
                      onChange={() => onToggleFamily(id)}
                    />
                    <span>
                      {FAMILY_LABELS[id]}
                      <span style={{ color: "var(--muted)", display: "block" }}>
                        {CONFLICT_GROUPS.find((g) => g.id === group)?.id}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            {conflictMessage && (
              <p style={{ color: "var(--danger, #b91c1c)", marginTop: 8 }}>
                {conflictMessage}
              </p>
            )}
            {prefs.families.length !== 4 && (
              <p style={{ color: "var(--muted)", marginTop: 8, fontSize: 13 }}>
                Select exactly four families ({prefs.families.length} selected).
              </p>
            )}
          </fieldset>

          <label>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              Q2 — Legs per slip: {prefs.legsPerSlip}
            </div>
            <input
              type="range"
              min={1}
              max={6}
              value={prefs.legsPerSlip}
              onChange={(e) => set("legsPerSlip", Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </label>

          <label>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              Q3 — Minimum probability (p_min):{" "}
              {(prefs.pMin * 100).toFixed(0)}%
            </div>
            <input
              type="range"
              min={50}
              max={90}
              value={Math.round(prefs.pMin * 100)}
              onChange={(e) => set("pMin", Number(e.target.value) / 100)}
              style={{ width: "100%" }}
            />
          </label>

          <fieldset>
            <legend style={{ fontWeight: 600, marginBottom: 8 }}>
              Q4 — Competitions (empty = all six)
            </legend>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 8,
              }}
            >
              {SLIP_COMPETITIONS.map((c) => {
                const checked =
                  prefs.competitions.length === 0 ||
                  prefs.competitions.includes(c);
                return (
                  <label key={c} style={{ display: "flex", gap: 6, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const all = [...SLIP_COMPETITIONS];
                        let next: string[];
                        if (prefs.competitions.length === 0) {
                          next = all.filter((x) => x !== c);
                        } else if (prefs.competitions.includes(c)) {
                          next = prefs.competitions.filter((x) => x !== c);
                        } else {
                          next = [...prefs.competitions, c];
                        }
                        if (next.length === all.length) next = [];
                        set("competitions", next);
                      }}
                    />
                    {c}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <label>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                Q5 — Window start
              </div>
              <input
                type="date"
                value={prefs.windowStart}
                onChange={(e) => set("windowStart", e.target.value)}
                style={{ width: "100%" }}
              />
            </label>
            <label>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                Q5 — Window end
              </div>
              <input
                type="date"
                value={prefs.windowEnd}
                onChange={(e) => set("windowEnd", e.target.value)}
                style={{ width: "100%" }}
              />
            </label>
          </div>

          <label>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              Q6 — Max legs from one competition: {prefs.maxLegsPerCompetition}
            </div>
            <input
              type="range"
              min={1}
              max={6}
              value={prefs.maxLegsPerCompetition}
              onChange={(e) =>
                set("maxLegsPerCompetition", Number(e.target.value))
              }
              style={{ width: "100%" }}
            />
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={prefs.excludeUncalibrated}
              onChange={(e) => set("excludeUncalibrated", e.target.checked)}
            />
            <span style={{ fontWeight: 600 }}>
              Q7 — Exclude uncalibrated markets
            </span>
          </label>

          <label>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              Q8 — Correlation ceiling: {prefs.correlationCeiling.toFixed(2)}
            </div>
            <input
              type="range"
              min={20}
              max={60}
              value={Math.round(prefs.correlationCeiling * 100)}
              onChange={(e) =>
                set("correlationCeiling", Number(e.target.value) / 100)
              }
              style={{ width: "100%" }}
            />
          </label>

          <label>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              Q9 — Your note for this batch
            </div>
            <p style={{ color: "var(--muted)", fontSize: 12, margin: "0 0 6px" }}>
              Saved with the batch — not read by the selection engine.
            </p>
            <textarea
              value={prefs.userNote}
              onChange={(e) => set("userNote", e.target.value)}
              rows={2}
              style={{ width: "100%", resize: "vertical" }}
              placeholder="Optional note"
            />
          </label>
        </div>
      )}
    </section>
  );
}
