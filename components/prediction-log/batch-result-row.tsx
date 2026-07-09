"use client";

import { applyTeamStatsSync } from "@/lib/prediction-log/team-stats-sync";
import { scoreComboLeg } from "@/lib/prediction-log/combo-scoring";
import { LOG_MARKET_MAP, pickOptionsForMarket } from "@/lib/prediction-log/markets-config";
import { DEFAULT_COMBO_MARKETS } from "@/lib/prediction-log/combo-markets-config";
import {
  matchLegLabel,
  resolveMarketMode,
  singleMarketKey,
} from "@/lib/prediction-log/match-entry-helpers";
import type { LogMatch, ScoreResult } from "@/lib/prediction-log/types";
import { BatchResultAdvanced } from "./batch-result-advanced";

function primaryLegResult(match: LogMatch): ScoreResult {
  const mode = resolveMarketMode(match);
  if (mode === "combined" && match.comboPick?.comboId) {
    const home = match.teamStats?.home?.goals;
    const away = match.teamStats?.away?.goals;
    if (home == null || away == null) return null;
    return scoreComboLeg(match.comboPick.comboId, match.actualResults, match.teamStats);
  }
  const key = singleMarketKey(match);
  if (!key) return null;
  return match.scored[key] ?? null;
}

function pickDisplay(match: LogMatch): string {
  const mode = resolveMarketMode(match);
  if (mode === "combined" && match.comboPick?.comboId) {
    const combo = DEFAULT_COMBO_MARKETS.find((c) => c.id === match.comboPick!.comboId);
    return combo?.label ?? match.comboPick.comboId.replace(/_/g, " ");
  }
  const key = singleMarketKey(match);
  if (!key) return "—";
  const pred = match.predictions[key];
  if (!pred?.prediction) return "—";
  const opts = pickOptionsForMarket(key, match.homeTeam, match.awayTeam, pred.line);
  return opts.find((o) => o.value === pred.prediction)?.label ?? pred.prediction;
}

function marketDisplay(match: LogMatch): string {
  const mode = resolveMarketMode(match);
  if (mode === "combined") return "Combined";
  const key = singleMarketKey(match);
  if (!key) return "—";
  return LOG_MARKET_MAP[key]?.label ?? key;
}

function setGoal(
  match: LogMatch,
  side: "home" | "away",
  value: string
): LogMatch {
  const teamStats = {
    home: { ...match.teamStats?.home },
    away: { ...match.teamStats?.away },
    firstHalfResult: match.teamStats?.firstHalfResult,
    goalTiming: match.teamStats?.goalTiming,
    penaltyAwarded: match.teamStats?.penaltyAwarded,
  };
  const trimmed = value.trim();
  if (trimmed === "") {
    delete teamStats[side].goals;
  } else {
    const n = parseInt(trimmed, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 99) {
      teamStats[side].goals = n;
    }
  }
  return applyTeamStatsSync({ ...match, teamStats });
}

interface BatchResultRowProps {
  index: number;
  match: LogMatch;
  expanded: boolean;
  onToggleExpand: () => void;
  homeScoreRef?: React.RefObject<HTMLInputElement | null>;
  awayScoreRef?: React.RefObject<HTMLInputElement | null>;
  onChange: (match: LogMatch) => void;
  onCellKeyDown?: (e: React.KeyboardEvent, col: number) => void;
}

export function BatchResultRow({
  index,
  match,
  expanded,
  onToggleExpand,
  homeScoreRef,
  awayScoreRef,
  onChange,
  onCellKeyDown,
}: BatchResultRowProps) {
  const result = primaryLegResult(match);
  const rowClass =
    result === "correct" ? "batch-row-correct" : result === "wrong" ? "batch-row-wrong" : "";

  const homeGoals = match.teamStats?.home?.goals;
  const awayGoals = match.teamStats?.away?.goals;

  return (
    <>
      <tr className={rowClass}>
        <td className="batch-col-frozen batch-col-num" style={{ left: 0, width: "2rem" }}>
          <button
            type="button"
            className="batch-expand-btn"
            tabIndex={-1}
            onClick={onToggleExpand}
            title="Advanced stats"
          >
            {expanded ? "▾" : "▸"}
          </button>
          {index + 1}
        </td>
        <td className="batch-col-frozen batch-col-team" style={{ left: "2.25rem" }} title={match.homeTeam}>
          {match.homeTeam || "—"}
        </td>
        <td className="batch-col-frozen batch-col-team" style={{ left: "11.75rem" }} title={match.awayTeam}>
          {match.awayTeam || "—"}
        </td>
        <td className="batch-col-market" title={matchLegLabel(match)}>
          {marketDisplay(match)}
        </td>
        <td className="batch-col-pick" title={pickDisplay(match)}>
          {pickDisplay(match)}
        </td>
        <td className="batch-col-score">
          <input
            ref={homeScoreRef}
            type="text"
            inputMode="numeric"
            maxLength={2}
            placeholder="H"
            value={homeGoals != null ? String(homeGoals) : ""}
            onChange={(e) => onChange(setGoal(match, "home", e.target.value))}
            onKeyDown={(e) => onCellKeyDown?.(e, 0)}
          />
        </td>
        <td className="batch-col-score">
          <input
            ref={awayScoreRef}
            type="text"
            inputMode="numeric"
            maxLength={2}
            placeholder="A"
            value={awayGoals != null ? String(awayGoals) : ""}
            onChange={(e) => onChange(setGoal(match, "away", e.target.value))}
            onKeyDown={(e) => onCellKeyDown?.(e, 1)}
          />
        </td>
        <td className="batch-col-outcome">
          {result ?? (homeGoals != null && awayGoals != null ? "…" : "—")}
        </td>
        <td className="batch-col-actions">
          {result === "correct" ? (
            <span style={{ color: "var(--accent)", fontWeight: 700 }}>✓</span>
          ) : result === "wrong" ? (
            <span style={{ color: "var(--danger)", fontWeight: 700 }}>✕</span>
          ) : result === "push" ? (
            <span style={{ color: "var(--warn)", fontWeight: 700 }}>P</span>
          ) : null}
        </td>
      </tr>
      {expanded ? (
        <tr className="batch-advanced-row">
          <td colSpan={9}>
            <BatchResultAdvanced match={match} onChange={onChange} />
          </td>
        </tr>
      ) : null}
    </>
  );
}
