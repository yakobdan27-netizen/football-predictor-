"use client";

import { CombinedOddsSettingsPanel } from "./combined-odds-settings-panel";
import { usePredictionLogData } from "./use-prediction-log-data";
import type { MarketMode } from "@/lib/prediction-log/types";

export function SettingsApp() {
  const { ready, error, comboSettings, setComboOddsSettings } = usePredictionLogData();

  if (!ready) {
    return <p style={{ color: "var(--muted)" }}>Loading settings…</p>;
  }
  if (error) {
    return <p style={{ color: "var(--danger)" }}>{error}</p>;
  }

  function patchEntryPrefs(patch: Partial<typeof comboSettings>) {
    setComboOddsSettings({ ...comboSettings, ...patch });
  }

  return (
    <div>
      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem" }}>
          Market Preferences
        </h2>
        <p style={{ fontSize: "0.8125rem", color: "var(--muted)", marginBottom: "1rem" }}>
          Control which market types appear when entering a new prediction batch.
        </p>

        <div style={{ display: "grid", gap: "0.75rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={comboSettings.showSingleMarkets}
              onChange={(e) => patchEntryPrefs({ showSingleMarkets: e.target.checked })}
            />
            Show single markets
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={comboSettings.showCombinedMarkets}
              onChange={(e) => patchEntryPrefs({ showCombinedMarkets: e.target.checked })}
            />
            Show combined markets
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={comboSettings.highlightPositiveValue}
              onChange={(e) => patchEntryPrefs({ highlightPositiveValue: e.target.checked })}
            />
            Highlight positive value
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={comboSettings.warnNegativeValue}
              onChange={(e) => patchEntryPrefs({ warnNegativeValue: e.target.checked })}
            />
            Warn on negative value
          </label>

          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend className="label" style={{ marginBottom: "0.5rem" }}>
              Default market mode for new matches
            </legend>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              {(["single", "combined"] as MarketMode[]).map((mode) => (
                <label
                  key={mode}
                  style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.875rem" }}
                >
                  <input
                    type="radio"
                    name="defaultMarketMode"
                    checked={comboSettings.defaultMarketMode === mode}
                    onChange={() => patchEntryPrefs({ defaultMarketMode: mode })}
                  />
                  {mode === "single" ? "Single" : "Combined"}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </section>

      <CombinedOddsSettingsPanel settings={comboSettings} onChange={setComboOddsSettings} />
    </div>
  );
}
