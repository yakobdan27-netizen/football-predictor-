"use client";

import { defaultCombinedOddsSettings } from "@/lib/prediction-log/combo-settings";
import { DEFAULT_COMBO_MARKETS } from "@/lib/prediction-log/combo-markets-config";
import type { CombinedOddsSettings } from "@/lib/prediction-log/types";

interface CombinedOddsSettingsPanelProps {
  settings: CombinedOddsSettings;
  onChange: (settings: CombinedOddsSettings) => void;
}

export function CombinedOddsSettingsPanel({
  settings,
  onChange,
}: CombinedOddsSettingsPanelProps) {
  return (
    <details className="card" style={{ marginBottom: "1rem" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Combined odds settings</summary>
      <div style={{ marginTop: "1rem", display: "grid", gap: "1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem" }}>
          {(["safe", "balanced", "aggressive"] as const).map((tier) => (
            <div key={tier}>
              <label className="label">{tier} accumulator floor (%)</label>
              <input
                className="input"
                type="number"
                min={40}
                max={95}
                value={settings.tierMinPFinal[tier]}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    tierMinPFinal: {
                      ...settings.tierMinPFinal,
                      [tier]: Number(e.target.value) || settings.tierMinPFinal[tier],
                    },
                  })
                }
              />
            </div>
          ))}
        </div>
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--muted)" }}>
          Floors are soft warnings for the batch accumulator. Per-match combo picks always use the
          highest probability among enabled markets.
        </p>

        <div>
          <label className="label">Better alternative threshold (%)</label>
          <input
            className="input"
            type="number"
            min={1}
            max={30}
            style={{ maxWidth: "180px" }}
            value={settings.betterAlternativeThresholdPct}
            onChange={(e) =>
              onChange({
                ...settings,
                betterAlternativeThresholdPct: Math.max(1, Math.min(30, Number(e.target.value) || 8)),
              })
            }
          />
        </div>

        <div>
          <label className="label">Combo Bayesian shrink min sample</label>
          <input
            className="input"
            type="number"
            min={8}
            max={20}
            style={{ maxWidth: "180px" }}
            value={settings.comboShrinkMinSample}
            onChange={(e) =>
              onChange({
                ...settings,
                comboShrinkMinSample: Math.max(8, Math.min(20, Number(e.target.value) || 12)),
              })
            }
          />
        </div>

        <div>
          <div className="label" style={{ marginBottom: "0.5rem" }}>
            Enabled combo markets ({settings.markets.filter((m) => m.enabled).length}/
            {settings.markets.length})
          </div>
          <div style={{ maxHeight: "240px", overflowY: "auto", display: "grid", gap: "0.35rem" }}>
            {settings.markets.map((market) => (
              <label
                key={market.id}
                style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem" }}
              >
                <input
                  type="checkbox"
                  checked={market.enabled}
                  onChange={(e) =>
                    onChange({
                      ...settings,
                      markets: settings.markets.map((m) =>
                        m.id === market.id ? { ...m, enabled: e.target.checked } : m
                      ),
                    })
                  }
                />
                {market.label}
                {market.requiresHalfTime ? (
                  <span style={{ color: "var(--muted)", fontSize: "0.7rem" }}>(HT)</span>
                ) : null}
              </label>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onChange(defaultCombinedOddsSettings())}
        >
          Reset to defaults
        </button>
        <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: 0 }}>
          Default catalog includes {DEFAULT_COMBO_MARKETS.length} combo types from the brief.
        </p>
      </div>
    </details>
  );
}
