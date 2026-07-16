"use client";

import { PickSegment } from "@/components/pick-segment";
import { useMatchEntryProbability } from "@/components/prediction-log/use-match-entry-probability";
import { useCorrectScoreAnalysis } from "@/components/prediction-log/use-correct-score-analysis";
import { CorrectScoreHonestyNote } from "@/components/prediction-log/correct-score-honesty-note";
import { formatValueEdge, entryValueFromGrid } from "@/lib/prediction-log/combo-entry-probability";
import { formatScoreline } from "@/lib/prediction-log/correct-score";
import { enabledComboMarkets } from "@/lib/prediction-log/combo-markets-config";
import {
  defaultPrediction,
  LOG_MARKETS,
  marketHasLineOptions,
  pickOptionsForMarket,
} from "@/lib/prediction-log/markets-config";
import {
  resolveMarketMode,
  setSingleMarket,
  singleMarketKey,
  switchMarketMode,
} from "@/lib/prediction-log/match-entry-helpers";
import { teamsForLeague } from "@/lib/prediction-log/teams";
import { isValidOdds, impliedProbability } from "@/lib/prediction-log/odds-bands";
import { isValueBet, valueGapPercent } from "@/lib/prediction-log/systematic-odds";
import type {
  CombinedOddsSettings,
  LogMarketKey,
  LogMatch,
  MarketMode,
  MarketPrediction,
} from "@/lib/prediction-log/types";

interface MatchPredictionFormProps {
  match: LogMatch;
  league: string;
  date: string;
  index: number;
  comboSettings: CombinedOddsSettings;
  onChange: (match: LogMatch) => void;
  onCopyPrevious?: () => void;
  showCopyPrevious?: boolean;
}

function updatePrediction(
  match: LogMatch,
  key: LogMarketKey,
  patch: Partial<MarketPrediction>
): LogMatch {
  const current = match.predictions[key] ?? defaultPrediction(key);
  return {
    ...match,
    predictions: {
      ...match.predictions,
      [key]: { ...current, ...patch },
    },
  };
}

function ProbValueRow({
  pGrid,
  valueEdge,
  loading,
  highlightPositive,
  warnNegative,
}: {
  pGrid: number | null;
  valueEdge: number | null;
  loading: boolean;
  highlightPositive: boolean;
  warnNegative: boolean;
}) {
  const value = formatValueEdge(valueEdge, highlightPositive);
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "1rem",
        fontSize: "0.8125rem",
        marginTop: "0.5rem",
      }}
    >
      <span>
        <span style={{ color: "var(--muted)" }}>System Prob: </span>
        <strong>{loading ? "…" : pGrid != null ? `${pGrid}%` : "—"}</strong>
      </span>
      <span>
        <span style={{ color: "var(--muted)" }}>Value: </span>
        <strong style={{ color: value.color }}>{loading ? "…" : value.text}</strong>
      </span>
      {warnNegative && valueEdge != null && valueEdge < 0 ? (
        <span style={{ color: "var(--warn)", fontSize: "0.75rem" }}>
          Negative value — you can still save
        </span>
      ) : null}
    </div>
  );
}

export function MatchPredictionForm({
  match,
  league,
  date,
  index,
  comboSettings,
  onChange,
  onCopyPrevious,
  showCopyPrevious,
}: MatchPredictionFormProps) {
  const teams = teamsForLeague(league);
  const mode = resolveMarketMode(match);
  const activeKey = singleMarketKey(match);
  const prob = useMatchEntryProbability(match, league, date);
  const csAnalysis = useCorrectScoreAnalysis(match, league, date);
  const combos = enabledComboMarkets(comboSettings.markets);
  const csEnabled = Boolean(match.correctScorePick);

  const modeOptions: Array<{ value: MarketMode; label: string; disabled?: boolean }> = [];
  if (comboSettings.showSingleMarkets) modeOptions.push({ value: "single", label: "Single" });
  if (comboSettings.showCombinedMarkets) modeOptions.push({ value: "combined", label: "Combined" });

  function handleModeChange(next: MarketMode) {
    onChange(switchMarketMode(match, next));
  }

  function renderSingleBlock() {
    const key = activeKey;
    const marketSelect = (
      <div>
        <label className="label">Market</label>
        <select
          className="select"
          value={key ?? ""}
          onChange={(e) => {
            const mk = e.target.value as LogMarketKey;
            if (mk) onChange(setSingleMarket(match, mk));
          }}
        >
          <option value="">Select a market…</option>
          {LOG_MARKETS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
    );

    if (!key) return marketSelect;

    const def = LOG_MARKETS.find((m) => m.key === key)!;
    const pred: MarketPrediction = match.predictions[key] ?? defaultPrediction(key);
    const home = match.homeTeam || "Home";
    const away = match.awayTeam || "Away";
    const line = pred.line ?? def.defaultLine;
    const options = pickOptionsForMarket(key, home, away, line);

    return (
      <div style={{ display: "grid", gap: "0.75rem" }}>
        {marketSelect}
        <div
          style={{
            padding: "0.75rem",
            background: "var(--surface2)",
            borderRadius: "8px",
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ marginBottom: "0.5rem" }}>
            <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              Confidence {pred.confidence}%
              <input
                type="range"
                min={0}
                max={100}
                value={pred.confidence}
                onChange={(e) =>
                  onChange(
                    updatePrediction(match, key, {
                      confidence: parseInt(e.target.value, 10),
                    })
                  )
                }
                style={{ marginLeft: "0.35rem", verticalAlign: "middle", width: "4rem" }}
              />
            </label>
          </div>

          {marketHasLineOptions(def) && (
            <div className="chip-scroll" style={{ marginBottom: "0.5rem" }}>
              {def.lineOptions!.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`chip${line === l ? " selected" : ""}`}
                  onClick={() => onChange(updatePrediction(match, key, { line: l }))}
                >
                  {l}
                </button>
              ))}
            </div>
          )}

          <PickSegment
            options={options}
            value={pred.prediction}
            onChange={(v) => onChange(updatePrediction(match, key, { prediction: v }))}
            ariaLabel={def.label}
          />

          <div style={{ marginTop: "0.75rem" }}>
            <label className="label">Odds (1.00 – 3.00)</label>
            <input
              className="input"
              type="number"
              step="0.01"
              min={1}
              max={3}
              placeholder="e.g. 1.85"
              value={pred.odds ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                const updated = updatePrediction(match, key, {
                  odds: v === "" ? undefined : parseFloat(v),
                });
                onChange(updated);
              }}
            />
            {pred.odds != null && !isValidOdds(pred.odds) && (
              <p style={{ color: "var(--danger)", fontSize: "0.75rem", margin: "0.25rem 0 0" }}>
                Odds must be between 1.00 and 3.00
              </p>
            )}
            {isValidOdds(pred.odds) && (
              <p style={{ color: "var(--muted)", fontSize: "0.75rem", margin: "0.25rem 0 0" }}>
                Implied: {(impliedProbability(pred.odds!) * 100).toFixed(1)}%
                {valueGapPercent(pred.confidence, pred.odds!) != null && (
                  <>
                    {" "}
                    · Your edge: {valueGapPercent(pred.confidence, pred.odds!)}%
                    {isValueBet(pred.confidence, pred.odds!) ? (
                      <span style={{ color: "var(--accent)" }}> · Value bet</span>
                    ) : (
                      <span style={{ color: "var(--warn)" }}> · Below 8% margin</span>
                    )}
                  </>
                )}
              </p>
            )}
          </div>

          <ProbValueRow
            pGrid={prob.pGrid}
            valueEdge={prob.valueEdge}
            loading={prob.loading}
            highlightPositive={comboSettings.highlightPositiveValue}
            warnNegative={comboSettings.warnNegativeValue}
          />
        </div>
      </div>
    );
  }

  function renderCombinedBlock() {
    const comboId = match.comboPick?.comboId ?? "";
    return (
      <div style={{ display: "grid", gap: "0.75rem" }}>
        <div>
          <label className="label">Combo market</label>
          <select
            className="select"
            value={comboId}
            onChange={(e) => {
              const id = e.target.value;
              onChange({
                ...match,
                marketMode: "combined",
                comboPick: {
                  comboId: id,
                  odds: match.comboPick?.odds ?? 0,
                  systemProbability: prob.pGrid ?? undefined,
                  valueEdge: prob.valueEdge ?? undefined,
                },
              });
            }}
          >
            <option value="">Select a combo…</option>
            {combos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Combined odds (1.00 – 3.00)</label>
          <input
            className="input"
            type="number"
            step="0.01"
            min={1}
            max={3}
            placeholder="e.g. 3.20"
            value={match.comboPick?.odds && match.comboPick.odds > 0 ? match.comboPick.odds : ""}
            onChange={(e) => {
              const v = e.target.value;
              const odds = v === "" ? 0 : parseFloat(v);
              onChange({
                ...match,
                marketMode: "combined",
                comboPick: {
                  comboId: match.comboPick?.comboId ?? "",
                  odds,
                  systemProbability: prob.pGrid ?? undefined,
                  valueEdge:
                    prob.pGrid != null && isValidOdds(odds)
                      ? (prob.pGrid / 100) * odds * 100 - 100
                      : undefined,
                },
              });
            }}
          />
        </div>

        <ProbValueRow
          pGrid={prob.pGrid}
          valueEdge={prob.valueEdge}
          loading={prob.loading}
          highlightPositive={comboSettings.highlightPositiveValue}
          warnNegative={comboSettings.warnNegativeValue}
        />
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.75rem",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <strong>Match {index + 1}</strong>
        {showCopyPrevious && onCopyPrevious && (
          <button type="button" className="btn btn-secondary" onClick={onCopyPrevious}>
            Copy previous match picks
          </button>
        )}
      </div>

      <div style={{ display: "grid", gap: "0.75rem", marginBottom: "1rem" }}>
        <div>
          <label className="label">Home team</label>
          <select
            className="select"
            value={match.homeTeam}
            onChange={(e) => onChange({ ...match, homeTeam: e.target.value })}
          >
            <option value="">Select team…</option>
            {teams.map((t) => (
              <option key={t} value={t} disabled={t === match.awayTeam}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Away team</label>
          <select
            className="select"
            value={match.awayTeam}
            onChange={(e) => onChange({ ...match, awayTeam: e.target.value })}
          >
            <option value="">Select team…</option>
            {teams.map((t) => (
              <option key={t} value={t} disabled={t === match.homeTeam}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {modeOptions.length > 1 ? (
        <div style={{ marginBottom: "0.75rem" }}>
          <div className="label" style={{ marginBottom: "0.35rem" }}>
            Market mode
          </div>
          <PickSegment
            options={modeOptions.map((o) => ({ value: o.value, label: o.label }))}
            value={mode}
            onChange={(v) => handleModeChange(v as MarketMode)}
            ariaLabel="Market mode"
          />
        </div>
      ) : null}

      {mode === "combined" ? renderCombinedBlock() : renderSingleBlock()}

      <details style={{ marginTop: "1rem" }} open={csEnabled}>
        <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.875rem" }}>
          Correct score (optional)
        </summary>
        <div
          style={{
            marginTop: "0.5rem",
            padding: "0.75rem",
            borderRadius: "6px",
            border: "1px solid var(--warn)",
            background: "rgba(255, 193, 7, 0.06)",
            fontSize: "0.8125rem",
          }}
        >
          Correct score is a high-variance market. Even the top pick rarely exceeds 12–15%. Not
          recommended for safe batches.
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.75rem" }}>
          <input
            type="checkbox"
            checked={csEnabled}
            onChange={(e) => {
              if (!e.target.checked) {
                onChange({ ...match, correctScorePick: undefined });
                return;
              }
              const top = csAnalysis.analysis?.mostLikely;
              if (!top) {
                // Keep toggle off when we cannot predict
                return;
              }
              onChange({
                ...match,
                correctScorePick: { home: top.home, away: top.away, odds: undefined },
              });
            }}
            disabled={!csEnabled && !csAnalysis.analysis?.mostLikely && !csAnalysis.loading}
          />
          Add correct-score bet for this match
        </label>
        {!csEnabled && csAnalysis.error ? (
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "var(--muted)" }}>
            {csAnalysis.error}
          </p>
        ) : null}
        {csEnabled && match.correctScorePick ? (
          <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
            <div>
              <label className="label">Pick from top scores</label>
              <select
                className="select"
                value={`${match.correctScorePick.home}-${match.correctScorePick.away}`}
                onChange={(e) => {
                  const [h, a] = e.target.value.split("-").map(Number);
                  if (!Number.isFinite(h) || !Number.isFinite(a)) return;
                  const row = csAnalysis.analysis?.top6.find((t) => t.home === h && t.away === a);
                  onChange({
                    ...match,
                    correctScorePick: {
                      ...match.correctScorePick!,
                      home: h,
                      away: a,
                      systemProbability: row?.probPct,
                      valueEdge:
                        entryValueFromGrid(row?.probPct ?? null, match.correctScorePick?.odds) ??
                        undefined,
                    },
                  });
                }}
              >
                {(csAnalysis.analysis?.top6 ?? []).map((row) => (
                  <option key={`${row.home}-${row.away}`} value={`${row.home}-${row.away}`}>
                    {formatScoreline(row.home, row.away)} ({row.probPct}%)
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <div>
                <label className="label">Home goals</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={6}
                  style={{ maxWidth: "80px" }}
                  value={match.correctScorePick.home}
                  onChange={(e) => {
                    const home = Math.min(6, Math.max(0, parseInt(e.target.value, 10) || 0));
                    const row = csAnalysis.analysis?.top6.find(
                      (t) => t.home === home && t.away === match.correctScorePick!.away
                    );
                    onChange({
                      ...match,
                      correctScorePick: {
                        ...match.correctScorePick!,
                        home,
                        systemProbability: row?.probPct,
                      },
                    });
                  }}
                />
              </div>
              <div>
                <label className="label">Away goals</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={6}
                  style={{ maxWidth: "80px" }}
                  value={match.correctScorePick.away}
                  onChange={(e) => {
                    const away = Math.min(6, Math.max(0, parseInt(e.target.value, 10) || 0));
                    const row = csAnalysis.analysis?.top6.find(
                      (t) => t.home === match.correctScorePick!.home && t.away === away
                    );
                    onChange({
                      ...match,
                      correctScorePick: {
                        ...match.correctScorePick!,
                        away,
                        systemProbability: row?.probPct,
                      },
                    });
                  }}
                />
              </div>
            </div>
            <div>
              <label className="label">Odds (optional)</label>
              <input
                className="input"
                type="number"
                step="0.01"
                min={1}
                placeholder="e.g. 8.00"
                style={{ maxWidth: "140px" }}
                value={match.correctScorePick.odds ?? ""}
                onChange={(e) => {
                  const odds = e.target.value === "" ? undefined : parseFloat(e.target.value);
                  const p = match.correctScorePick?.systemProbability ?? null;
                  onChange({
                    ...match,
                    correctScorePick: {
                      ...match.correctScorePick!,
                      odds,
                      valueEdge: entryValueFromGrid(p, odds) ?? undefined,
                    },
                  });
                }}
              />
            </div>
            {match.correctScorePick.systemProbability != null ? (
              <p style={{ margin: 0, fontSize: "0.8125rem" }}>
                System prob: {match.correctScorePick.systemProbability}%
                {match.correctScorePick.valueEdge != null ? (
                  <>
                    {" · "}
                    Value:{" "}
                    <span
                      style={{
                        color: formatValueEdge(
                          match.correctScorePick.valueEdge,
                          comboSettings.highlightPositiveValue
                        ).color,
                      }}
                    >
                      {
                        formatValueEdge(
                          match.correctScorePick.valueEdge,
                          comboSettings.highlightPositiveValue
                        ).text
                      }
                    </span>
                  </>
                ) : null}
              </p>
            ) : csAnalysis.loading ? (
              <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--muted)" }}>Loading grid…</p>
            ) : csAnalysis.error ? (
              <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--muted)" }}>
                {csAnalysis.error}
              </p>
            ) : null}
            <CorrectScoreHonestyNote compact />
          </div>
        ) : null}
      </details>
    </div>
  );
}
