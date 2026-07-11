"use client";

import {
  formatAltWouldHaveWonNote,
} from "@/lib/prediction-log/grade-from-facts";
import {
  cloneMatchTeamStats,
  resultCompleteness,
} from "@/lib/prediction-log/match-learning";
import { applyTeamStatsSync, setHomePossession } from "@/lib/prediction-log/team-stats-sync";
import { LOG_MARKET_MAP, pickOptionsForMarket } from "@/lib/prediction-log/markets-config";
import { DEFAULT_COMBO_MARKETS } from "@/lib/prediction-log/combo-markets-config";
import {
  matchLegLabel,
  resolveMarketMode,
  singleMarketKey,
} from "@/lib/prediction-log/match-entry-helpers";
import type { ResultGridField } from "@/lib/prediction-log/result-grid-fields";
import { withClosingOdds } from "@/lib/prediction-log/evaluation-metrics";
import type { LogMatch, ScoreResult, TeamSideStats } from "@/lib/prediction-log/types";
import type { ReactNode } from "react";
import { BatchResultAdvanced } from "./batch-result-advanced";

function primaryLegResult(match: LogMatch): ScoreResult {
  if (match.primaryGrade?.result != null) return match.primaryGrade.result;
  const mode = resolveMarketMode(match);
  if (mode === "combined" && match.comboPick?.comboId) {
    return match.primaryGrade?.result ?? null;
  }
  const key = singleMarketKey(match);
  if (!key) return null;
  return match.scored[key] ?? null;
}

function GradeBadge({ result }: { result: ScoreResult }) {
  if (result === "correct") {
    return <span className="batch-grade-badge batch-grade-correct">Won</span>;
  }
  if (result === "wrong") {
    return <span className="batch-grade-badge batch-grade-wrong">Lost</span>;
  }
  if (result === "void") {
    return <span className="batch-grade-badge batch-grade-void">Void</span>;
  }
  if (result === "push") {
    return <span className="batch-grade-badge batch-grade-push">Push</span>;
  }
  return <span className="batch-grade-badge">—</span>;
}

function outcomeMark(result: ScoreResult): ReactNode {
  if (result === "correct") {
    return <span className="batch-outcome-mark batch-grade-correct">✓</span>;
  }
  if (result === "wrong") {
    return <span className="batch-outcome-mark batch-grade-wrong">✕</span>;
  }
  if (result === "void") {
    return <span className="batch-outcome-mark batch-grade-void">–</span>;
  }
  if (result === "push") {
    return <span className="batch-outcome-mark batch-grade-push">P</span>;
  }
  return null;
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

function setSideStat(
  match: LogMatch,
  side: "home" | "away",
  field: keyof TeamSideStats,
  value: string
): LogMatch {
  const teamStats = cloneMatchTeamStats(match);
  const trimmed = value.trim();
  if (trimmed === "") {
    delete teamStats[side][field];
  } else {
    const n = parseInt(trimmed, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 99) {
      teamStats[side][field] = n;
    }
  }
  return applyTeamStatsSync({ ...match, teamStats });
}

function setPenalty(
  match: LogMatch,
  side: "home" | "away",
  value: string
): LogMatch {
  const teamStats = cloneMatchTeamStats(match);
  const pens = { ...teamStats.penaltiesAwarded };
  const trimmed = value.trim();
  if (trimmed === "") {
    delete pens[side];
  } else {
    const n = parseInt(trimmed, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 9) {
      pens[side] = n;
    }
  }
  teamStats.penaltiesAwarded = pens;
  teamStats.penaltyAwarded =
    (pens.home != null && pens.home > 0) || (pens.away != null && pens.away > 0);
  return applyTeamStatsSync({ ...match, teamStats });
}

function setEarlyGoal(match: LogMatch, yes: boolean): LogMatch {
  const teamStats = cloneMatchTeamStats(match);
  teamStats.goalTiming = { ...teamStats.goalTiming, goalInFirst10: yes };
  return applyTeamStatsSync({ ...match, teamStats });
}

function setFirstGoalSide(
  match: LogMatch,
  side: "home" | "away" | "none"
): LogMatch {
  const teamStats = cloneMatchTeamStats(match);
  teamStats.firstGoalSide = side;
  return applyTeamStatsSync({ ...match, teamStats });
}

function setAbnormal(match: LogMatch, checked: boolean): LogMatch {
  const teamStats = cloneMatchTeamStats(match);
  if (checked) teamStats.abnormalMatch = true;
  else delete teamStats.abnormalMatch;
  return applyTeamStatsSync({ ...match, teamStats });
}

function NumCell({
  value,
  placeholder,
  field,
  inputRef,
  onChange,
  onCellKeyDown,
  maxLength = 2,
}: {
  value?: number;
  placeholder: string;
  field: ResultGridField;
  inputRef?: React.RefObject<HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null>;
  onChange: (v: string) => void;
  onCellKeyDown?: (e: React.KeyboardEvent, field: ResultGridField) => void;
  maxLength?: number;
}) {
  return (
    <td className="batch-col-score">
      <input
        ref={inputRef as React.RefObject<HTMLInputElement | null>}
        type="text"
        inputMode="numeric"
        maxLength={maxLength}
        placeholder={placeholder}
        data-result-field={field}
        value={value != null ? String(value) : ""}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => onCellKeyDown?.(e, field)}
      />
    </td>
  );
}

interface BatchResultRowProps {
  index: number;
  match: LogMatch;
  league: string;
  showFullStats: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  cellRefs: Array<React.RefObject<HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null>>;
  fields: ResultGridField[];
  onChange: (match: LogMatch) => void;
  onCellKeyDown?: (e: React.KeyboardEvent, field: ResultGridField) => void;
}

export function BatchResultRow({
  index,
  match,
  league,
  showFullStats,
  expanded,
  onToggleExpand,
  cellRefs,
  fields,
  onChange,
  onCellKeyDown,
}: BatchResultRowProps) {
  const result = primaryLegResult(match);
  const rowClass =
    result === "correct"
      ? "batch-row-correct"
      : result === "wrong"
        ? "batch-row-wrong"
        : result === "void"
          ? "batch-row-void"
          : "";
  const completeness = resultCompleteness(match);
  const early = match.teamStats?.goalTiming?.goalInFirst10 === true;
  const earlyNo = match.teamStats?.goalTiming?.goalInFirst10 === false;
  const fg = match.teamStats?.firstGoalSide;
  const altNote = formatAltWouldHaveWonNote(match, match.primaryGrade, match.altGrade);

  const refFor = (field: ResultGridField) => {
    const i = fields.indexOf(field);
    return i >= 0 ? cellRefs[i] : undefined;
  };

  const colSpan = showFullStats ? 34 : 11;

  return (
    <>
      <tr className={rowClass}>
        <td className="batch-col-frozen batch-col-num">
          <span
            className={`batch-complete-dot batch-complete-${completeness}`}
            title={
              completeness === "full"
                ? "FT + advanced stats"
                : completeness === "ft"
                  ? "FT entered"
                  : "No FT yet"
            }
          />
          <button
            type="button"
            className="batch-expand-btn"
            tabIndex={-1}
            onClick={onToggleExpand}
            title="Grade details / timing"
          >
            {expanded ? "▾" : "▸"}
          </button>
          {index + 1}
        </td>
        <td className="batch-col-frozen batch-col-league" title={league}>
          <span className="batch-ellipsis">{league || "—"}</span>
        </td>
        <td className="batch-col-frozen batch-col-team batch-col-home" title={match.homeTeam}>
          <span className="batch-ellipsis">{match.homeTeam || "—"}</span>
        </td>
        <td className="batch-col-frozen batch-col-team batch-col-away" title={match.awayTeam}>
          <span className="batch-ellipsis">{match.awayTeam || "—"}</span>
        </td>
        <td className="batch-col-market" title={matchLegLabel(match)}>
          <span className="batch-ellipsis">{marketDisplay(match)}</span>
        </td>
        <td className="batch-col-pick batch-col-pick-secondary" title={pickDisplay(match)}>
          <span className="batch-ellipsis">{pickDisplay(match)}</span>
        </td>
        <td className="batch-col-stake" title={match.suggestedStake != null ? `Suggested ${match.suggestedStake}` : undefined}>
          {match.stake != null ? match.stake : "—"}
        </td>
        <td className="batch-col-close">
          <input
            className="input"
            type="number"
            min={1.01}
            step={0.01}
            placeholder="Close"
            title="Closing odds for CLV (optional)"
            aria-label="Closing odds"
            value={match.closingOdds ?? ""}
            onChange={(e) => onChange(withClosingOdds(match, e.target.value))}
            style={{ width: "4.25rem", padding: "0.2rem 0.35rem", fontSize: "0.8125rem" }}
          />
        </td>
        <td className="batch-col-score-pair">
          <div className="batch-score-pair">
            <input
              ref={refFor("ftH") as React.RefObject<HTMLInputElement | null>}
              type="text"
              inputMode="numeric"
              maxLength={2}
              placeholder="H"
              data-result-field="ftH"
              aria-label="Home FT goals"
              value={
                match.teamStats?.home?.goals != null
                  ? String(match.teamStats.home.goals)
                  : ""
              }
              onChange={(e) =>
                onChange(setSideStat(match, "home", "goals", e.target.value))
              }
              onKeyDown={(e) => onCellKeyDown?.(e, "ftH")}
            />
            <span className="batch-score-dash" aria-hidden>
              –
            </span>
            <input
              ref={refFor("ftA") as React.RefObject<HTMLInputElement | null>}
              type="text"
              inputMode="numeric"
              maxLength={2}
              placeholder="A"
              data-result-field="ftA"
              aria-label="Away FT goals"
              value={
                match.teamStats?.away?.goals != null
                  ? String(match.teamStats.away.goals)
                  : ""
              }
              onChange={(e) =>
                onChange(setSideStat(match, "away", "goals", e.target.value))
              }
              onKeyDown={(e) => onCellKeyDown?.(e, "ftA")}
            />
          </div>
        </td>
        <td className="batch-col-outcome">
          <GradeBadge result={result} />
        </td>
        <td className="batch-col-actions">{outcomeMark(result)}</td>

        {showFullStats ? (
          <>
            <NumCell
              field="htH"
              placeholder="H"
              value={match.teamStats?.home?.firstHalfGoals}
              inputRef={refFor("htH")}
              onChange={(v) => onChange(setSideStat(match, "home", "firstHalfGoals", v))}
              onCellKeyDown={onCellKeyDown}
            />
            <NumCell
              field="htA"
              placeholder="A"
              value={match.teamStats?.away?.firstHalfGoals}
              inputRef={refFor("htA")}
              onChange={(v) => onChange(setSideStat(match, "away", "firstHalfGoals", v))}
              onCellKeyDown={onCellKeyDown}
            />
            <td className="batch-col-toggle">
              <div className="batch-seg">
                <button
                  type="button"
                  ref={refFor("early") as React.RefObject<HTMLButtonElement | null>}
                  data-result-field="early"
                  className={early ? "active" : ""}
                  onClick={() => onChange(setEarlyGoal(match, true))}
                  onKeyDown={(e) => onCellKeyDown?.(e, "early")}
                >
                  Y
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  className={earlyNo ? "active" : ""}
                  onClick={() => onChange(setEarlyGoal(match, false))}
                >
                  N
                </button>
              </div>
            </td>

            <NumCell
              field="shotsH"
              placeholder="H"
              value={match.teamStats?.home?.totalShots}
              inputRef={refFor("shotsH")}
              onChange={(v) => onChange(setSideStat(match, "home", "totalShots", v))}
              onCellKeyDown={onCellKeyDown}
            />
            <NumCell
              field="shotsA"
              placeholder="A"
              value={match.teamStats?.away?.totalShots}
              inputRef={refFor("shotsA")}
              onChange={(v) => onChange(setSideStat(match, "away", "totalShots", v))}
              onCellKeyDown={onCellKeyDown}
            />
            <NumCell
              field="sotH"
              placeholder="H"
              value={match.teamStats?.home?.shotsOnTarget}
              inputRef={refFor("sotH")}
              onChange={(v) => onChange(setSideStat(match, "home", "shotsOnTarget", v))}
              onCellKeyDown={onCellKeyDown}
            />
            <NumCell
              field="sotA"
              placeholder="A"
              value={match.teamStats?.away?.shotsOnTarget}
              inputRef={refFor("sotA")}
              onChange={(v) => onChange(setSideStat(match, "away", "shotsOnTarget", v))}
              onCellKeyDown={onCellKeyDown}
            />
            <NumCell
              field="corH"
              placeholder="H"
              value={match.teamStats?.home?.corners}
              inputRef={refFor("corH")}
              onChange={(v) => onChange(setSideStat(match, "home", "corners", v))}
              onCellKeyDown={onCellKeyDown}
            />
            <NumCell
              field="corA"
              placeholder="A"
              value={match.teamStats?.away?.corners}
              inputRef={refFor("corA")}
              onChange={(v) => onChange(setSideStat(match, "away", "corners", v))}
              onCellKeyDown={onCellKeyDown}
            />
            <NumCell
              field="foulH"
              placeholder="H"
              value={match.teamStats?.home?.fouls}
              inputRef={refFor("foulH")}
              onChange={(v) => onChange(setSideStat(match, "home", "fouls", v))}
              onCellKeyDown={onCellKeyDown}
            />
            <NumCell
              field="foulA"
              placeholder="A"
              value={match.teamStats?.away?.fouls}
              inputRef={refFor("foulA")}
              onChange={(v) => onChange(setSideStat(match, "away", "fouls", v))}
              onCellKeyDown={onCellKeyDown}
            />
            <NumCell
              field="yelH"
              placeholder="H"
              value={match.teamStats?.home?.yellowCards}
              inputRef={refFor("yelH")}
              onChange={(v) => onChange(setSideStat(match, "home", "yellowCards", v))}
              onCellKeyDown={onCellKeyDown}
            />
            <NumCell
              field="yelA"
              placeholder="A"
              value={match.teamStats?.away?.yellowCards}
              inputRef={refFor("yelA")}
              onChange={(v) => onChange(setSideStat(match, "away", "yellowCards", v))}
              onCellKeyDown={onCellKeyDown}
            />
            <NumCell
              field="redH"
              placeholder="H"
              value={match.teamStats?.home?.redCards}
              inputRef={refFor("redH")}
              onChange={(v) => onChange(setSideStat(match, "home", "redCards", v))}
              onCellKeyDown={onCellKeyDown}
            />
            <NumCell
              field="redA"
              placeholder="A"
              value={match.teamStats?.away?.redCards}
              inputRef={refFor("redA")}
              onChange={(v) => onChange(setSideStat(match, "away", "redCards", v))}
              onCellKeyDown={onCellKeyDown}
            />
            <NumCell
              field="possH"
              placeholder="%"
              value={match.teamStats?.home?.possession}
              inputRef={refFor("possH")}
              maxLength={3}
              onChange={(v) => {
                const t = v.trim();
                onChange(
                  setHomePossession(match, t === "" ? "" : parseInt(t, 10))
                );
              }}
              onCellKeyDown={onCellKeyDown}
            />
            <td className="batch-col-score batch-col-readonly" title="Auto 100−home">
              {match.teamStats?.away?.possession != null
                ? match.teamStats.away.possession
                : "—"}
            </td>
            <NumCell
              field="offH"
              placeholder="H"
              value={match.teamStats?.home?.offsides}
              inputRef={refFor("offH")}
              onChange={(v) => onChange(setSideStat(match, "home", "offsides", v))}
              onCellKeyDown={onCellKeyDown}
            />
            <NumCell
              field="offA"
              placeholder="A"
              value={match.teamStats?.away?.offsides}
              inputRef={refFor("offA")}
              onChange={(v) => onChange(setSideStat(match, "away", "offsides", v))}
              onCellKeyDown={onCellKeyDown}
            />
            <td className="batch-col-toggle batch-col-fg">
              <div className="batch-seg">
                <button
                  type="button"
                  ref={refFor("firstGoal") as React.RefObject<HTMLButtonElement | null>}
                  data-result-field="firstGoal"
                  className={fg === "home" ? "active" : ""}
                  onClick={() => onChange(setFirstGoalSide(match, "home"))}
                  onKeyDown={(e) => onCellKeyDown?.(e, "firstGoal")}
                >
                  H
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  className={fg === "away" ? "active" : ""}
                  onClick={() => onChange(setFirstGoalSide(match, "away"))}
                >
                  A
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  className={fg === "none" ? "active" : ""}
                  onClick={() => onChange(setFirstGoalSide(match, "none"))}
                >
                  —
                </button>
              </div>
            </td>
            <NumCell
              field="penH"
              placeholder="H"
              value={match.teamStats?.penaltiesAwarded?.home}
              inputRef={refFor("penH")}
              onChange={(v) => onChange(setPenalty(match, "home", v))}
              onCellKeyDown={onCellKeyDown}
            />
            <NumCell
              field="penA"
              placeholder="A"
              value={match.teamStats?.penaltiesAwarded?.away}
              inputRef={refFor("penA")}
              onChange={(v) => onChange(setPenalty(match, "away", v))}
              onCellKeyDown={onCellKeyDown}
            />
            <td className="batch-col-toggle">
              <input
                ref={refFor("abnormal") as React.RefObject<HTMLInputElement | null>}
                type="checkbox"
                data-result-field="abnormal"
                checked={!!match.teamStats?.abnormalMatch}
                title="Abnormal match (down-weight learning)"
                onChange={(e) => onChange(setAbnormal(match, e.target.checked))}
                onKeyDown={(e) => onCellKeyDown?.(e, "abnormal")}
              />
            </td>
          </>
        ) : null}
      </tr>
      {expanded ? (
        <tr className="batch-advanced-row">
          <td colSpan={colSpan}>
            <div className="batch-grade-details">
              <strong>Details</strong>
              <p>{match.primaryGrade?.reason ?? "Enter stats to grade this pick."}</p>
              {altNote ? <p className="batch-alt-note">{altNote}</p> : null}
              {match.altGrade && !altNote ? (
                <p className="batch-alt-note">
                  Suggested {match.altGrade.marketLabel}:{" "}
                  {match.altGrade.result === "correct"
                    ? "would have won ✓"
                    : match.altGrade.result === "wrong"
                      ? "would have lost ✗"
                      : match.altGrade.result === "void"
                        ? "void"
                        : "pending"}
                </p>
              ) : null}
              {match.silentGrades && Object.keys(match.silentGrades).length > 0 ? (
                <div style={{ marginTop: "0.5rem" }}>
                  <strong style={{ fontSize: "11px" }}>Derived outcomes (silent)</strong>
                  <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.1rem", fontSize: "11px" }}>
                    {Object.entries(match.silentGrades)
                      .filter(([, g]) => g.actual != null)
                      .slice(0, 12)
                      .map(([key, g]) => (
                        <li key={key}>
                          {key}: {String(g.actual)}
                          {g.result && g.result !== null ? ` (${g.result})` : ""}
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
              {match.teamStats?.lineups ? (
                <div style={{ marginTop: "0.65rem", fontSize: "11px" }}>
                  <strong>Lineups</strong>
                  <div style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: "1fr 1fr", marginTop: "0.35rem" }}>
                    <div>
                      <div style={{ color: "var(--muted)" }}>
                        {match.homeTeam}
                        {match.teamStats.lineups.home.formation
                          ? ` · ${match.teamStats.lineups.home.formation}`
                          : ""}
                      </div>
                      <div>
                        XI: {match.teamStats.lineups.home.starting.join(", ") || "—"}
                      </div>
                      {match.teamStats.lineups.home.substitutes.length > 0 ? (
                        <div style={{ color: "var(--muted)" }}>
                          Subs: {match.teamStats.lineups.home.substitutes.join(", ")}
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <div style={{ color: "var(--muted)" }}>
                        {match.awayTeam}
                        {match.teamStats.lineups.away.formation
                          ? ` · ${match.teamStats.lineups.away.formation}`
                          : ""}
                      </div>
                      <div>
                        XI: {match.teamStats.lineups.away.starting.join(", ") || "—"}
                      </div>
                      {match.teamStats.lineups.away.substitutes.length > 0 ? (
                        <div style={{ color: "var(--muted)" }}>
                          Subs: {match.teamStats.lineups.away.substitutes.join(", ")}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <BatchResultAdvanced match={match} onChange={onChange} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** Apply a paste patch of string field values onto a match. */
export function applyResultPastePatch(
  match: LogMatch,
  patch: Partial<Record<ResultGridField, string>>
): LogMatch {
  let next = match;
  const num = (v: string | undefined) => (v == null ? undefined : v);
  if (num(patch.htH) !== undefined) next = setSideStat(next, "home", "firstHalfGoals", patch.htH!);
  if (num(patch.htA) !== undefined) next = setSideStat(next, "away", "firstHalfGoals", patch.htA!);
  if (num(patch.ftH) !== undefined) next = setSideStat(next, "home", "goals", patch.ftH!);
  if (num(patch.ftA) !== undefined) next = setSideStat(next, "away", "goals", patch.ftA!);
  if (patch.early != null) {
    const v = patch.early.trim().toLowerCase();
    if (v === "y" || v === "yes" || v === "1" || v === "true") next = setEarlyGoal(next, true);
    else if (v === "n" || v === "no" || v === "0" || v === "false") next = setEarlyGoal(next, false);
  }
  if (num(patch.shotsH) !== undefined) next = setSideStat(next, "home", "totalShots", patch.shotsH!);
  if (num(patch.shotsA) !== undefined) next = setSideStat(next, "away", "totalShots", patch.shotsA!);
  if (num(patch.sotH) !== undefined) next = setSideStat(next, "home", "shotsOnTarget", patch.sotH!);
  if (num(patch.sotA) !== undefined) next = setSideStat(next, "away", "shotsOnTarget", patch.sotA!);
  if (num(patch.corH) !== undefined) next = setSideStat(next, "home", "corners", patch.corH!);
  if (num(patch.corA) !== undefined) next = setSideStat(next, "away", "corners", patch.corA!);
  if (num(patch.foulH) !== undefined) next = setSideStat(next, "home", "fouls", patch.foulH!);
  if (num(patch.foulA) !== undefined) next = setSideStat(next, "away", "fouls", patch.foulA!);
  if (num(patch.yelH) !== undefined) next = setSideStat(next, "home", "yellowCards", patch.yelH!);
  if (num(patch.yelA) !== undefined) next = setSideStat(next, "away", "yellowCards", patch.yelA!);
  if (num(patch.redH) !== undefined) next = setSideStat(next, "home", "redCards", patch.redH!);
  if (num(patch.redA) !== undefined) next = setSideStat(next, "away", "redCards", patch.redA!);
  if (num(patch.possH) !== undefined) {
    const t = patch.possH!.trim();
    next = setHomePossession(next, t === "" ? "" : parseInt(t, 10));
  }
  if (num(patch.offH) !== undefined) next = setSideStat(next, "home", "offsides", patch.offH!);
  if (num(patch.offA) !== undefined) next = setSideStat(next, "away", "offsides", patch.offA!);
  if (patch.firstGoal != null) {
    const v = patch.firstGoal.trim().toLowerCase();
    if (v === "h" || v === "home") next = setFirstGoalSide(next, "home");
    else if (v === "a" || v === "away") next = setFirstGoalSide(next, "away");
    else if (v === "n" || v === "none" || v === "-" || v === "") next = setFirstGoalSide(next, "none");
  }
  if (num(patch.penH) !== undefined) next = setPenalty(next, "home", patch.penH!);
  if (num(patch.penA) !== undefined) next = setPenalty(next, "away", patch.penA!);
  if (patch.abnormal != null) {
    const v = patch.abnormal.trim().toLowerCase();
    next = setAbnormal(
      next,
      v === "1" || v === "y" || v === "yes" || v === "true" || v === "x"
    );
  }
  return next;
}
