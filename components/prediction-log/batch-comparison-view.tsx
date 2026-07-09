"use client";

import { useState } from "react";
import { LOG_MARKET_MAP } from "@/lib/prediction-log/markets-config";
import { pickOptionsForMarket } from "@/lib/prediction-log/markets-config";
import { RecommendedPickRow } from "./recommended-pick-row";
import type {
  LogMarketKey,
  LogMatch,
  MatchGameListEntry,
  MatchJudgmentLabel,
  PredictionBatch,
  RecommendedPick,
} from "@/lib/prediction-log/types";

type ViewMode = "original" | "recommended";

interface BatchComparisonViewProps {
  batch: PredictionBatch;
  learnerEnabled?: boolean;
  onUpdateRecommended: (batch: PredictionBatch) => void;
}

const JUDGMENT_COLORS: Record<MatchJudgmentLabel, string> = {
  strong_keep: "var(--accent)",
  keep_caution: "var(--warn)",
  skip: "var(--danger)",
};

function GameListEntry({ entry }: { entry: MatchGameListEntry }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        padding: "0.75rem",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        marginBottom: "0.5rem",
        opacity: entry.selected ? 1 : 0.72,
        background: entry.selected ? "rgba(76, 175, 80, 0.04)" : undefined,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <strong>
          {entry.homeTeam} vs {entry.awayTeam}
        </strong>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            Similarity {entry.similarityScore}
          </span>
          {entry.legOdds != null && (
            <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Leg {entry.legOdds}</span>
          )}
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              color: JUDGMENT_COLORS[entry.judgment],
              textTransform: "uppercase",
            }}
          >
            {entry.judgmentText}
          </span>
          {entry.selected && (
            <span style={{ fontSize: "0.7rem", color: "var(--accent)", fontWeight: 600 }}>
              Selected
            </span>
          )}
        </div>
      </div>
      {entry.skipReason && !entry.selected && (
        <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.35rem" }}>
          {entry.skipReason}
        </p>
      )}
      {entry.evidence.length > 0 && (
        <div style={{ marginTop: "0.35rem" }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: "0.75rem", padding: "0.15rem 0.5rem" }}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide evidence" : `Evidence (${entry.evidence.length})`}
          </button>
          {open && (
            <ul style={{ marginTop: "0.35rem", paddingLeft: "1.25rem", fontSize: "0.8rem" }}>
              {entry.evidence.map((e, i) => (
                <li key={i}>
                  <strong>{e.label}:</strong> {e.value}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function OriginalPickRow({
  marketKey,
  match,
}: {
  marketKey: LogMarketKey;
  match: LogMatch;
}) {
  const pred = match.predictions[marketKey];
  if (!pred) return null;
  const def = LOG_MARKET_MAP[marketKey];
  const opts = pickOptionsForMarket(marketKey, match.homeTeam, match.awayTeam, pred.line);
  const label = opts.find((o) => o.value === pred.prediction)?.label ?? pred.prediction;

  return (
    <div
      style={{
        padding: "0.75rem",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        marginBottom: "0.5rem",
      }}
    >
      <strong>{def?.label ?? marketKey}</strong>
      <div style={{ fontSize: "0.875rem", marginTop: "0.25rem" }}>
        {label}
        {pred.line != null ? ` (${pred.line})` : ""} · odds {pred.odds} · {pred.confidence}%
      </div>
    </div>
  );
}

export function BatchComparisonView({ batch, learnerEnabled, onUpdateRecommended }: BatchComparisonViewProps) {
  const [view, setView] = useState<ViewMode>("recommended");
  const recommended = batch.recommended;

  if (!recommended) {
    return (
      <p className="page-sub">No recommended batch generated for this entry.</p>
    );
  }

  function updatePick(matchId: string, marketKey: LogMarketKey, pick: RecommendedPick) {
    if (!batch.recommended) return;
    const matches = batch.recommended.matches.map((rm) => {
      if (rm.id !== matchId) return rm;
      return {
        ...rm,
        predictions: { ...rm.predictions, [marketKey]: pick },
      };
    });
    onUpdateRecommended({
      ...batch,
      recommended: { ...batch.recommended, matches },
    });
  }

  function acceptPick(matchId: string, marketKey: LogMarketKey) {
    const rm = batch.recommended?.matches.find((m) => m.id === matchId);
    const pick = rm?.predictions[marketKey];
    if (!pick || !batch.recommended) return;
    updatePick(matchId, marketKey, { ...pick, accepted: true });
  }

  function acceptAll() {
    if (!batch.recommended) return;
    const matches = batch.recommended.matches.map((rm) => ({
      ...rm,
      predictions: Object.fromEntries(
        Object.entries(rm.predictions).map(([k, p]) => [
          k,
          { ...p, accepted: true },
        ])
      ) as typeof rm.predictions,
    }));
    onUpdateRecommended({
      ...batch,
      recommended: { ...batch.recommended, matches, acceptAll: true },
    });
  }

  const summary = recommended.summary;
  const riskColors = { low: "var(--accent)", medium: "var(--warn)", high: "var(--danger)" };

  return (
    <div>
      {summary && (
        <div
          className="card"
          style={{ marginBottom: "1rem", borderColor: "var(--border)" }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center" }}>
            {summary.totalCombinedOdds != null && (
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Combined odds</div>
                <strong style={{ fontSize: "1.25rem" }}>{summary.totalCombinedOdds}</strong>
              </div>
            )}
            <div>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Risk level</div>
              <strong style={{ color: riskColors[summary.riskLevel], textTransform: "capitalize" }}>
                {summary.riskLevel}
              </strong>
            </div>
            <div>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Matches</div>
              <strong>
                {summary.matchesIncluded} selected · {summary.matchesDropped} dropped
              </strong>
            </div>
          </div>
          <p style={{ fontSize: "0.875rem", marginTop: "0.75rem", color: "var(--muted)" }}>
            {summary.summaryJudgment}
          </p>
          {summary.clubInsight && (
            <p style={{ fontSize: "0.875rem", marginTop: "0.5rem", color: "var(--accent)" }}>
              {summary.clubInsight}
            </p>
          )}
          {recommended.learnerGenerated && learnerEnabled && (
            <p style={{ fontSize: "0.875rem", marginTop: "0.5rem", color: "var(--accent)", fontWeight: 600 }}>
              AI Learner recommendation — traceable to your saved history.
            </p>
          )}
          {summary.exclusions.length > 0 && (
            <details style={{ marginTop: "0.75rem" }}>
              <summary style={{ cursor: "pointer", fontSize: "0.875rem" }}>
                Excluded matches ({summary.exclusions.length})
              </summary>
              <ul style={{ marginTop: "0.5rem", paddingLeft: "1.25rem", fontSize: "0.8rem" }}>
                {summary.exclusions.map((ex) => (
                  <li key={ex.matchId} style={{ marginBottom: "0.25rem" }}>
                    <strong>
                      {ex.homeTeam} vs {ex.awayTeam}
                    </strong>
                    : {ex.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {recommended.gameList && recommended.gameList.length > 0 && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Game list</h3>
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
            All entered matches with similarity score, judgment, and supporting evidence.
          </p>
          {recommended.gameList.map((entry) => (
            <GameListEntry key={entry.matchId} entry={entry} />
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          className={`chip${view === "original" ? " selected" : ""}`}
          onClick={() => setView("original")}
        >
          Original
        </button>
        <button
          type="button"
          className={`chip${view === "recommended" ? " selected" : ""}`}
          onClick={() => setView("recommended")}
        >
          {recommended.learnerGenerated && learnerEnabled ? "Learner Recommended" : "Recommended"}
        </button>
        <span style={{ fontSize: "0.875rem", color: "var(--muted)", marginLeft: "0.5rem" }}>
          {recommended.displayName}
        </span>
        {view === "recommended" && (
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginLeft: "auto", fontSize: "0.85rem" }}
            onClick={acceptAll}
          >
            {recommended.acceptAll ? "All accepted" : "Accept all"}
          </button>
        )}
      </div>

      {view === "original" &&
        batch.matches.map((match) => (
          <div key={match.id} className="card" style={{ marginBottom: "1rem" }}>
            <strong>
              {match.homeTeam} vs {match.awayTeam}
            </strong>
            {(Object.keys(match.predictions) as LogMarketKey[]).map((key) => (
              <OriginalPickRow key={key} marketKey={key} match={match} />
            ))}
          </div>
        ))}

      {view === "recommended" &&
        recommended.matches.map((rm) => {
          const match = batch.matches.find((m) => m.id === rm.id);
          if (!match) return null;
          const gameEntry = recommended.gameList?.find((g) => g.matchId === rm.id);
          return (
            <div key={rm.id} className="card" style={{ marginBottom: "1rem" }}>
              <strong>
                {rm.homeTeam} vs {rm.awayTeam}
              </strong>
              {(Object.keys(rm.predictions) as LogMarketKey[]).map((key) => {
                const pick = rm.predictions[key];
                if (!pick) return null;
                return (
                  <RecommendedPickRow
                    key={key}
                    marketKey={key}
                    pick={pick}
                    homeTeam={match.homeTeam}
                    awayTeam={match.awayTeam}
                    matchJudgment={gameEntry?.judgmentText}
                    evidence={gameEntry?.evidence}
                    onChange={(p) => updatePick(match.id, key, p)}
                    onAccept={() => acceptPick(match.id, key)}
                  />
                );
              })}
            </div>
          );
        })}
    </div>
  );
}
