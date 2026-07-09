"use client";

import {
  LOG_MARKET_MAP,
  pickOptionsForMarket,
} from "@/lib/prediction-log/markets-config";
import { isValidOdds } from "@/lib/prediction-log/odds-bands";
import type { EvidencePoint, LogMarketKey, MarketPrediction, RecommendedPick } from "@/lib/prediction-log/types";

interface RecommendedPickRowProps {
  marketKey: LogMarketKey;
  pick: RecommendedPick;
  homeTeam: string;
  awayTeam: string;
  matchJudgment?: string;
  evidence?: EvidencePoint[];
  onChange: (pick: RecommendedPick) => void;
  onAccept: () => void;
}

const ACTION_COLORS: Record<string, string> = {
  keep: "var(--accent)",
  revise: "var(--warn)",
  remove: "var(--danger)",
  add_alternative: "var(--muted)",
};

function pickLabel(
  key: LogMarketKey,
  pred: MarketPrediction,
  home: string,
  away: string
): string {
  const opts = pickOptionsForMarket(key, home, away, pred.line);
  const found = opts.find((o) => o.value === pred.prediction);
  if (found) return found.label;
  if (pred.line != null) return `${pred.prediction} ${pred.line}`;
  return pred.prediction;
}

const LEARNER_LABEL_DISPLAY: Record<string, { text: string; color: string }> = {
  learner_suggestion: { text: "Learner Suggestion", color: "var(--accent)" },
  risk_removed: { text: "Risk Removed", color: "var(--danger)" },
  kept_by_learner: { text: "Kept by Learner", color: "var(--muted)" },
};

export function RecommendedPickRow({
  marketKey,
  pick,
  homeTeam,
  awayTeam,
  matchJudgment,
  evidence,
  onChange,
  onAccept,
}: RecommendedPickRowProps) {
  const def = LOG_MARKET_MAP[marketKey];
  const changed =
    pick.action !== "keep" ||
    (pick.original != null &&
      (pick.original.prediction !== pick.prediction ||
        pick.original.line !== pick.line ||
        pick.original.confidence !== pick.confidence ||
        pick.original.odds !== pick.odds));

  if (pick.action === "remove") {
    return (
      <div
        style={{
          padding: "0.75rem",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          marginBottom: "0.5rem",
          opacity: 0.85,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
          <strong>{def?.label ?? marketKey}</strong>
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              color: ACTION_COLORS.remove,
              textTransform: "uppercase",
            }}
          >
            removed
          </span>
        </div>
        {pick.original && (
          <div style={{ fontSize: "0.875rem", color: "var(--muted)", marginTop: "0.25rem" }}>
            Was: {pickLabel(marketKey, pick.original, homeTeam, awayTeam)} @ {pick.original.odds}
          </div>
        )}
        <p style={{ fontSize: "0.875rem", marginTop: "0.5rem" }}>{pick.judgment}</p>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}
          onClick={onAccept}
        >
          {pick.accepted ? "Accepted removal" : "Accept removal"}
        </button>
      </div>
    );
  }

  const options = pickOptionsForMarket(marketKey, homeTeam, awayTeam, pick.line);

  return (
    <div
      style={{
        padding: "0.75rem",
        border: `1px solid ${changed ? "var(--warn)" : "var(--border)"}`,
        borderRadius: "6px",
        marginBottom: "0.5rem",
        background: changed ? "rgba(255, 193, 7, 0.05)" : undefined,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
        <strong>{def?.label ?? marketKey}</strong>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          {matchJudgment && (
            <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--accent)" }}>
              {matchJudgment}
            </span>
          )}
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              color: ACTION_COLORS[pick.action] ?? "var(--muted)",
              textTransform: "uppercase",
            }}
          >
            {pick.action.replace("_", " ")}
          </span>
          {pick.learnerLabel && LEARNER_LABEL_DISPLAY[pick.learnerLabel] && (
            <span
              style={{
                fontSize: "0.7rem",
                fontWeight: 700,
                color: LEARNER_LABEL_DISPLAY[pick.learnerLabel].color,
              }}
            >
              {LEARNER_LABEL_DISPLAY[pick.learnerLabel].text}
            </span>
          )}
          {pick.learnerConfidence != null && (
            <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--accent)" }}>
              Confidence: {pick.learnerConfidence}%
            </span>
          )}
        </div>
      </div>

      {pick.original && changed && (
        <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.25rem" }}>
          Was: {pickLabel(marketKey, pick.original, homeTeam, awayTeam)} @ {pick.original.odds} (
          {pick.original.confidence}%)
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "0.5rem",
          marginTop: "0.5rem",
        }}
      >
        {options.length > 0 && (
          <div>
            <label className="label">Pick</label>
            <select
              className="input"
              value={pick.prediction}
              onChange={(e) => onChange({ ...pick, prediction: e.target.value })}
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {def?.lineOptions && (
          <div>
            <label className="label">Line</label>
            <select
              className="input"
              value={pick.line ?? def.defaultLine ?? ""}
              onChange={(e) => onChange({ ...pick, line: parseFloat(e.target.value) })}
            >
              {def.lineOptions.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">Odds</label>
          <input
            className="input"
            type="number"
            step="0.01"
            min={1}
            max={3}
            value={pick.odds ?? ""}
            onChange={(e) =>
              onChange({
                ...pick,
                odds: e.target.value === "" ? undefined : parseFloat(e.target.value),
              })
            }
          />
        </div>
        <div>
          <label className="label">Confidence %</label>
          <input
            className="input"
            type="number"
            min={0}
            max={100}
            value={pick.confidence}
            onChange={(e) =>
              onChange({ ...pick, confidence: parseInt(e.target.value, 10) || 0 })
            }
          />
        </div>
      </div>

      {pick.confidenceBreakdown && (
        <p style={{ fontSize: "0.8rem", color: "var(--accent)", marginTop: "0.35rem" }}>
          {pick.confidenceBreakdown}
        </p>
      )}

      <p style={{ fontSize: "0.875rem", marginTop: "0.5rem", color: "var(--muted)" }}>
        {pick.judgment}
      </p>

      {pick.learnerWhy && (
        <details style={{ marginTop: "0.35rem" }}>
          <summary style={{ cursor: "pointer", fontSize: "0.8rem", color: "var(--accent)" }}>
            Why this was recommended
          </summary>
          <p style={{ fontSize: "0.8rem", marginTop: "0.25rem", color: "var(--muted)" }}>
            {pick.learnerWhy}
          </p>
        </details>
      )}

      {evidence && evidence.length > 0 && (
        <ul style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.35rem", paddingLeft: "1.25rem" }}>
          {evidence.map((e, i) => (
            <li key={i}>
              <strong>{e.label}:</strong> {e.value}
            </li>
          ))}
        </ul>
      )}

      {!isValidOdds(pick.odds) && (
        <p style={{ fontSize: "0.8rem", color: "var(--danger)" }}>Odds must be 1.00–3.00</p>
      )}

      <button
        type="button"
        className={`btn ${pick.accepted ? "btn-secondary" : "btn-primary"}`}
        style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}
        onClick={onAccept}
      >
        {pick.accepted ? "Accepted" : "Accept pick"}
      </button>
    </div>
  );
}
