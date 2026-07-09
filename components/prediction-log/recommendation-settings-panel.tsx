"use client";

import type { RecommendationSettings } from "@/lib/prediction-log/types";

interface RecommendationSettingsPanelProps {
  settings: RecommendationSettings;
  onChange: (settings: RecommendationSettings) => void;
}

export function RecommendationSettingsPanel({
  settings,
  onChange,
}: RecommendationSettingsPanelProps) {
  return (
    <details className="card" style={{ marginBottom: "1rem" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        Recommendation settings
      </summary>
      <div style={{ marginTop: "1rem" }}>
        <label className="label" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={settings.oddsFilteringEnabled}
            onChange={(e) =>
              onChange({ ...settings, oddsFilteringEnabled: e.target.checked })
            }
          />
          Odds-based filtering (1.40 – 2.60)
        </label>
        <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
          Applies per-leg hard filters on new batch saves. Batch size is not capped — use the
          dynamic risk panel to review total odds and remove legs if needed.
        </p>

        <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
          <div>
            <label className="label">Tier 1 minimum P_final</label>
            <input
              className="input"
              type="number"
              min={50}
              max={95}
              step={1}
              value={settings.tier1MinPFinal}
              onChange={(e) =>
                onChange({
                  ...settings,
                  tier1MinPFinal: Math.max(50, Math.min(95, Number(e.target.value) || 72)),
                })
              }
              style={{ maxWidth: "180px" }}
            />
          </div>

          <div>
            <label className="label">Tier 3 maximum batch risk (R_batch)</label>
            <input
              className="input"
              type="number"
              min={0.1}
              max={1}
              step={0.05}
              value={settings.tier3MaxBatchRisk}
              onChange={(e) =>
                onChange({
                  ...settings,
                  tier3MaxBatchRisk: Math.max(0.1, Math.min(1, Number(e.target.value) || 0.6)),
                })
              }
              style={{ maxWidth: "180px" }}
            />
          </div>

          <label className="label" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={settings.tier3AllowAlternativeMarkets}
              onChange={(e) =>
                onChange({ ...settings, tier3AllowAlternativeMarkets: e.target.checked })
              }
            />
            Allow alternative markets in Tier 3
          </label>

          <div>
            <label className="label">Better alternative threshold (%)</label>
            <input
              className="input"
              type="number"
              min={1}
              max={30}
              step={1}
              value={settings.betterAlternativeThresholdPct}
              onChange={(e) =>
                onChange({
                  ...settings,
                  betterAlternativeThresholdPct: Math.max(
                    1,
                    Math.min(30, Number(e.target.value) || 8)
                  ),
                })
              }
              style={{ maxWidth: "180px" }}
            />
            <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
              Show a better market on the summary when its P_final beats the selected market by at
              least this margin.
            </p>
          </div>
        </div>
      </div>
    </details>
  );
}
