"use client";

import type {
  BankrollRiskProfile,
  BankrollStrategySettings,
  RecommendationSettings,
  StakingMode,
} from "@/lib/prediction-log/types";
import {
  ABSOLUTE_STAKE_CAP_PCT,
  RISK_PROFILE_MAX_PCT,
  defaultBankrollStrategySettings,
} from "@/lib/prediction-log/recommendation-config";
import {
  evaluateBankrollHealth,
  evaluateStopLoss,
  formatMoney,
  maxRecommendedStake,
} from "@/lib/prediction-log/strategy-rules";
import { loadBatches } from "@/lib/prediction-log/storage";

interface BankrollStrategyPanelProps {
  settings: RecommendationSettings;
  onChange: (settings: RecommendationSettings) => void;
}

const STAKING_LABELS: Record<StakingMode, string> = {
  flat: "Flat %",
  quarter_kelly: "Quarter-Kelly",
  half_kelly: "Half-Kelly",
};

export function BankrollStrategyPanel({ settings, onChange }: BankrollStrategyPanelProps) {
  const bs = settings.bankrollStrategy ?? defaultBankrollStrategySettings();
  const stop = evaluateStopLoss(loadBatches(), bs);
  const health = evaluateBankrollHealth(bs);
  const maxStake = maxRecommendedStake(bs);

  function patch(partial: Partial<BankrollStrategySettings>) {
    onChange({
      ...settings,
      bankrollStrategy: { ...bs, ...partial },
    });
  }

  function setBankroll(n: number | null) {
    const next: Partial<BankrollStrategySettings> = { bankroll: n };
    if (n != null && n > 0 && (bs.startingBankroll == null || bs.startingBankroll <= 0)) {
      next.startingBankroll = n;
    }
    patch(next);
  }

  function applyRiskProfile(profile: BankrollRiskProfile) {
    patch({
      riskProfile: profile,
      maxRiskPctPerBet: RISK_PROFILE_MAX_PCT[profile],
    });
  }

  return (
    <section className="card" style={{ marginBottom: "1rem" }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.35rem" }}>
        Bankroll & staking
      </h2>
      <p style={{ fontSize: "0.8125rem", color: "var(--muted)", marginBottom: "1rem" }}>
        Soft rules at bet placement (1–{ABSOLUTE_STAKE_CAP_PCT}% risk, flat / fractional Kelly,
        stop-loss alerts). Never hard-blocks saves. Set bankroll to enable stake suggestions.
      </p>

      <div style={{ display: "grid", gap: "0.75rem", maxWidth: 420 }}>
        <div>
          <label className="label">Bankroll</label>
          <input
            className="input"
            type="number"
            min={0}
            step={1}
            placeholder="e.g. 1000"
            value={bs.bankroll ?? ""}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              setBankroll(Number.isFinite(n) && n > 0 ? n : null);
            }}
          />
        </div>

        <div>
          <label className="label">Starting bankroll (baseline)</label>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              className="input"
              type="number"
              min={0}
              step={1}
              placeholder="Snapshot for 75/60/50% alerts"
              value={bs.startingBankroll ?? ""}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                patch({
                  startingBankroll: Number.isFinite(n) && n > 0 ? n : null,
                });
              }}
            />
            <button
              type="button"
              className="btn btn-ghost"
              style={{ whiteSpace: "nowrap", fontSize: "0.75rem" }}
              disabled={bs.bankroll == null}
              onClick={() =>
                patch({
                  startingBankroll: bs.bankroll,
                })
              }
            >
              Reset baseline
            </button>
          </div>
        </div>

        <div>
          <label className="label">Fun bankroll (optional)</label>
          <input
            className="input"
            type="number"
            min={0}
            step={1}
            placeholder="Looser play money — display only"
            value={bs.funBankroll ?? ""}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              patch({
                funBankroll: Number.isFinite(n) && n > 0 ? n : null,
              });
            }}
          />
        </div>

        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: "0.5rem" }}>
            Risk profile
          </legend>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {(["conservative", "moderate", "aggressive"] as BankrollRiskProfile[]).map(
              (profile) => (
                <label
                  key={profile}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    fontSize: "0.875rem",
                  }}
                >
                  <input
                    type="radio"
                    name="riskProfile"
                    checked={bs.riskProfile === profile}
                    onChange={() => applyRiskProfile(profile)}
                  />
                  {profile.charAt(0).toUpperCase() + profile.slice(1)} (
                  {RISK_PROFILE_MAX_PCT[profile]}%)
                </label>
              )
            )}
          </div>
        </fieldset>

        <div>
          <label className="label">Max risk per bet (%)</label>
          <input
            className="input"
            type="number"
            min={1}
            max={ABSOLUTE_STAKE_CAP_PCT}
            step={0.5}
            value={bs.maxRiskPctPerBet}
            onChange={(e) =>
              patch({
                maxRiskPctPerBet: Math.min(
                  ABSOLUTE_STAKE_CAP_PCT,
                  Math.max(1, parseFloat(e.target.value) || 1)
                ),
              })
            }
          />
          {maxStake != null ? (
            <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
              Max recommended stake: {maxStake.toFixed(2)}
            </p>
          ) : null}
        </div>

        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: "0.5rem" }}>
            Staking mode
          </legend>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {(["flat", "quarter_kelly", "half_kelly"] as StakingMode[]).map((mode) => (
              <label
                key={mode}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  fontSize: "0.875rem",
                }}
              >
                <input
                  type="radio"
                  name="stakingMode"
                  checked={bs.stakingMode === mode}
                  onChange={() => patch({ stakingMode: mode })}
                />
                {STAKING_LABELS[mode]}
              </label>
            ))}
          </div>
        </fieldset>

        {bs.stakingMode === "flat" ? (
          <div>
            <label className="label">Flat stake (% of bankroll)</label>
            <input
              className="input"
              type="number"
              min={0.1}
              max={ABSOLUTE_STAKE_CAP_PCT}
              step={0.1}
              value={bs.flatStakePct}
              onChange={(e) =>
                patch({
                  flatStakePct: Math.min(
                    ABSOLUTE_STAKE_CAP_PCT,
                    Math.max(0.1, parseFloat(e.target.value) || 1)
                  ),
                })
              }
            />
          </div>
        ) : null}

        <div>
          <label className="label">Tier stake multipliers</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
            {(["safe", "balanced", "aggressive"] as const).map((tier) => (
              <div key={tier}>
                <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{tier}</span>
                <input
                  className="input"
                  type="number"
                  min={0.1}
                  max={3}
                  step={0.05}
                  value={bs.tierStakeMult[tier]}
                  onChange={(e) =>
                    patch({
                      tierStakeMult: {
                        ...bs.tierStakeMult,
                        [tier]: Math.min(3, Math.max(0.1, parseFloat(e.target.value) || 1)),
                      },
                    })
                  }
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Stop-loss: consecutive losses</label>
          <input
            className="input"
            type="number"
            min={1}
            max={20}
            value={bs.stopLossConsecutiveLosses}
            onChange={(e) =>
              patch({
                stopLossConsecutiveLosses: Math.min(
                  20,
                  Math.max(1, parseInt(e.target.value, 10) || 3)
                ),
              })
            }
          />
        </div>

        <div>
          <label className="label">Stop-loss: daily drawdown (%)</label>
          <input
            className="input"
            type="number"
            min={1}
            max={50}
            value={bs.stopLossDailyDrawdownPct}
            onChange={(e) =>
              patch({
                stopLossDailyDrawdownPct: Math.min(
                  50,
                  Math.max(1, parseFloat(e.target.value) || 10)
                ),
              })
            }
          />
        </div>

        <div>
          <label className="label">Stop-loss: rolling window (days)</label>
          <input
            className="input"
            type="number"
            min={7}
            max={90}
            value={bs.stopLossRollingDays}
            onChange={(e) =>
              patch({
                stopLossRollingDays: Math.min(
                  90,
                  Math.max(7, parseInt(e.target.value, 10) || 30)
                ),
              })
            }
          />
        </div>

        <div>
          <label className="label">Stop-loss: rolling drawdown (%)</label>
          <input
            className="input"
            type="number"
            min={5}
            max={50}
            value={bs.stopLossRollingDrawdownPct}
            onChange={(e) =>
              patch({
                stopLossRollingDrawdownPct: Math.min(
                  50,
                  Math.max(5, parseFloat(e.target.value) || 25)
                ),
              })
            }
          />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={bs.strategyAlertsEnabled}
            onChange={(e) => patch({ strategyAlertsEnabled: e.target.checked })}
          />
          Strategy alerts enabled
        </label>
      </div>

      <div
        style={{
          marginTop: "1rem",
          fontSize: "0.8125rem",
          color: stop.stopLossActive ? "var(--danger)" : "var(--muted)",
        }}
      >
        {stop.stopLossActive ? (
          <>
            <strong>Stop-loss active:</strong> {stop.reason}. Suggested: pause new bets.
          </>
        ) : (
          <>
            Status OK
            {stop.consecutiveLosses > 0
              ? ` · ${stop.consecutiveLosses} consecutive loss(es)`
              : ""}
            {stop.todayPnL !== 0 ? ` · Today P&L ${formatMoney(stop.todayPnL)}` : ""}
            {stop.rollingDrawdownPct != null && stop.rollingDrawdownPct > 0
              ? ` · ${bs.stopLossRollingDays}d drawdown ${stop.rollingDrawdownPct}%`
              : ""}
          </>
        )}
      </div>

      {health.messages.length > 0 ? (
        <div
          style={{
            marginTop: "0.5rem",
            fontSize: "0.8125rem",
            color: "var(--danger)",
          }}
        >
          {health.messages.map((m) => (
            <div key={m}>{m}</div>
          ))}
        </div>
      ) : health.ratioToStart != null ? (
        <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--muted)" }}>
          Bankroll {health.ratioToStart}% of starting baseline
          {maxStake != null ? ` · max stake ${maxStake.toFixed(2)}` : ""}
        </div>
      ) : null}
    </section>
  );
}
