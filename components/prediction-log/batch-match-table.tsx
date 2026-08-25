"use client";

import { useCallback, useMemo, useState } from "react";
import {
  applyPastedTeamRows,
  parsePastedResultGrid,
  parsePastedRows,
} from "@/lib/prediction-log/parse-pasted-rows";
import {
  resultEditableFields,
  type ResultGridField,
} from "@/lib/prediction-log/result-grid-fields";
import { BatchEntryRow } from "./batch-entry-row";
import { applyResultPastePatch, BatchResultRow } from "./batch-result-row";
import { gradeMatchFromFacts } from "@/lib/prediction-log/grade-from-facts";
import type {
  BankrollStrategySettings,
  CombinedOddsSettings,
  FrozenBetterAlternative,
  LogMatch,
} from "@/lib/prediction-log/types";
import { matchLeague } from "@/lib/prediction-log/match-league";
import type { TeamsQualityStore } from "@/lib/prediction-log/teams-quality-types";
import {
  sortByTwoHHeavy,
  type TwoHHeavyResult,
} from "@/lib/prediction-log/two-h-heavy";

interface BatchMatchTableProps {
  mode: "entry" | "result";
  matches: LogMatch[];
  /** Default league for new rows; per-match league is on each LogMatch. */
  defaultLeague?: string;
  date?: string;
  comboSettings?: CombinedOddsSettings;
  bankrollStrategy?: BankrollStrategySettings;
  teamsQuality?: TeamsQualityStore | null;
  betterAltByMatch?: Record<string, FrozenBetterAlternative>;
  onChange: (matches: LogMatch[]) => void;
  onAddMatch?: () => void;
  /** Used when paste needs more rows than currently exist. */
  createEmptyMatch?: () => LogMatch;
  /** Advisory 2H-heavy scores keyed by match id (result mode). */
  twoHHeavyByMatch?: Record<string, TwoHHeavyResult>;
  /** When true, display rows sorted by p_2h_gt_1h (does not mutate stored order). */
  twoHHeavySort?: boolean;
  onTwoHHeavySortChange?: (enabled: boolean) => void;
}

/** Focusable entry cells: Home → Away → Market → Odds (League has its own select). */
const ENTRY_COLS = 4;

type FocusableRef = React.RefObject<
  HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null
>;

export function BatchMatchTable({
  mode,
  matches,
  defaultLeague = "",
  date = "",
  comboSettings,
  bankrollStrategy,
  teamsQuality = null,
  betterAltByMatch,
  onChange,
  onAddMatch,
  createEmptyMatch,
  twoHHeavyByMatch,
  twoHHeavySort = false,
  onTwoHHeavySortChange,
}: BatchMatchTableProps) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showFullStats, setShowFullStats] = useState(false);
  const resultFields = useMemo(
    () => resultEditableFields(showFullStats),
    [showFullStats]
  );
  const colCount = mode === "entry" ? ENTRY_COLS : resultFields.length;
  const showTwoH = mode === "result" && !!twoHHeavyByMatch;

  const displayMatches = useMemo(() => {
    if (!showTwoH || !twoHHeavySort || !twoHHeavyByMatch) return matches;
    return sortByTwoHHeavy(matches, twoHHeavyByMatch);
  }, [matches, showTwoH, twoHHeavySort, twoHHeavyByMatch]);

  const topFiveIds = useMemo(() => {
    if (!showTwoH || !twoHHeavySort || !twoHHeavyByMatch) return new Set<string>();
    return new Set(displayMatches.slice(0, 5).map((m) => m.id));
  }, [displayMatches, showTwoH, twoHHeavySort, twoHHeavyByMatch]);

  const rowKeys = displayMatches.map((m) => m.id).join("|");

  const cellRefs = useMemo(() => {
    return displayMatches.map(() =>
      Array.from({ length: colCount }, () => ({
        current: null as HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null,
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild when row count/ids/cols change
  }, [rowKeys, colCount]);

  const focusCell = useCallback(
    (row: number, col: number) => {
      const ref = cellRefs[row]?.[col];
      ref?.current?.focus();
    },
    [cellRefs]
  );

  const handleEntryKeyDown = useCallback(
    (e: React.KeyboardEvent, row: number, col: number) => {
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        if (col < ENTRY_COLS - 1) focusCell(row, col + 1);
        else if (row < displayMatches.length - 1) focusCell(row + 1, 0);
        else if (onAddMatch) {
          onAddMatch();
          setTimeout(() => focusCell(displayMatches.length, 0), 0);
        }
        return;
      }
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        if (col > 0) focusCell(row, col - 1);
        else if (row > 0) focusCell(row - 1, ENTRY_COLS - 1);
        return;
      }
      if (e.key === "Enter" && col === ENTRY_COLS - 1 && row === displayMatches.length - 1) {
        e.preventDefault();
        onAddMatch?.();
        setTimeout(() => focusCell(displayMatches.length, 0), 0);
      }
    },
    [focusCell, displayMatches.length, onAddMatch]
  );

  const handleResultKeyDown = useCallback(
    (e: React.KeyboardEvent, row: number, field: ResultGridField) => {
      const col = resultFields.indexOf(field);
      if (col < 0) return;
      const lastCol = resultFields.length - 1;

      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        if (col < lastCol) focusCell(row, col + 1);
        else if (row < displayMatches.length - 1) focusCell(row + 1, 0);
        return;
      }
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        if (col > 0) focusCell(row, col - 1);
        else if (row > 0) focusCell(row - 1, lastCol);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (row < displayMatches.length - 1) focusCell(row + 1, col);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (col < lastCol) focusCell(row, col + 1);
        else if (row < displayMatches.length - 1) focusCell(row + 1, 0);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (col > 0) focusCell(row, col - 1);
        else if (row > 0) focusCell(row - 1, lastCol);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (row < displayMatches.length - 1) focusCell(row + 1, col);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (row > 0) focusCell(row - 1, col);
      }
    },
    [focusCell, displayMatches.length, resultFields]
  );

  function withAltGrade(match: LogMatch): LogMatch {
    const alt = betterAltByMatch?.[match.id];
    if (!alt) return match;
    return gradeMatchFromFacts(match, { betterAlternative: alt });
  }

  /** Always patch by id so sorted display never rewrites stored order. */
  function updateMatchById(id: string, match: LogMatch) {
    onChange(matches.map((m) => (m.id === id ? withAltGrade(match) : m)));
  }

  function deleteMatchById(id: string) {
    if (matches.length <= 1) return;
    onChange(matches.filter((m) => m.id !== id));
  }

  function handlePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\t") && !text.includes("\n") && !text.includes(",")) return;

    if (mode === "entry") {
      const rows = parsePastedRows(text);
      if (rows.length === 0) return;
      e.preventDefault();
      const target = e.target as HTMLElement;
      const tr = target.closest("tr");
      const tbody = tr?.parentElement;
      const rowIndex = tr && tbody ? Array.from(tbody.children).indexOf(tr) : 0;
      const factory =
        createEmptyMatch ??
        (() => ({
          id: `paste-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          homeTeam: "",
          awayTeam: "",
          predictions: {},
          actualResults: {},
          scored: {},
        }));
      onChange(applyPastedTeamRows(matches, rows, rowIndex, factory));
      return;
    }

    const target = e.target as HTMLElement;
    const fieldAttr = target.closest("[data-result-field]")?.getAttribute("data-result-field");
    const startField = (fieldAttr as ResultGridField | null) ?? resultFields[0]!;
    const patches = parsePastedResultGrid(text, startField, resultFields);
    if (patches.length === 0) return;
    e.preventDefault();

    const tr = target.closest("tr");
    const tbody = tr?.parentElement;
    let rowIndex = 0;
    if (tr && tbody) {
      const dataRows = Array.from(tbody.children).filter(
        (el) => !el.classList.contains("batch-advanced-row")
      );
      rowIndex = Math.max(0, dataRows.indexOf(tr));
    }

    const next = [...matches];
    for (let i = 0; i < patches.length; i++) {
      const displayIdx = rowIndex + i;
      if (displayIdx >= displayMatches.length) break;
      const id = displayMatches[displayIdx]!.id;
      const srcIdx = next.findIndex((m) => m.id === id);
      if (srcIdx < 0) break;
      next[srcIdx] = withAltGrade(applyResultPastePatch(next[srcIdx]!, patches[i]!));
    }
    onChange(next);
  }

  if (mode === "entry" && !comboSettings) return null;

  return (
    <div className="batch-table-wrap" onPaste={handlePaste}>
      {mode === "result" ? (
        <div className="batch-result-toolbar">
          <label className="batch-full-stats-toggle">
            <input
              type="checkbox"
              checked={showFullStats}
              onChange={(e) => setShowFullStats(e.target.checked)}
            />
            Show full stats
          </label>
          {showTwoH && onTwoHHeavySortChange ? (
            <label className="batch-full-stats-toggle" title="Sort by P(2H>1H) — display only">
              <input
                type="checkbox"
                checked={twoHHeavySort}
                onChange={(e) => onTwoHHeavySortChange(e.target.checked)}
              />
              2H-heavy rank
            </label>
          ) : null}
        </div>
      ) : null}
      <table className={`batch-table${mode === "result" ? " batch-table-result" : ""}`}>
        <thead>
          {mode === "entry" ? (
            <tr>
              <th className="batch-col-frozen batch-col-num">#</th>
              <th className="batch-col-frozen batch-col-league">League</th>
              <th className="batch-col-frozen batch-col-team batch-col-home">Home</th>
              <th className="batch-col-frozen batch-col-team batch-col-away">Away</th>
              <th>Market</th>
              <th>Odds</th>
              <th className="batch-col-pick-secondary">System Pick</th>
              <th style={{ textAlign: "right" }}>Prob %</th>
              <th aria-label="Remove" />
            </tr>
          ) : (
            <>
              {showFullStats ? (
                <tr className="batch-group-headers">
                  <th className="batch-col-frozen" colSpan={4} />
                  <th colSpan={2} className="batch-group-label">
                    Pick
                  </th>
                  <th className="batch-group-label batch-group-ft" colSpan={1}>
                    FT
                  </th>
                  <th colSpan={2} className="batch-group-label batch-group-ht">
                    HT
                  </th>
                  <th colSpan={2} className="batch-group-label">
                    Half Σ
                  </th>
                  <th colSpan={2} className="batch-group-label">
                    Cor
                  </th>
                  <th colSpan={6} className="batch-group-label">
                    Goal timing
                  </th>
                  <th colSpan={2} />
                  {showTwoH ? (
                    <th colSpan={5} className="batch-group-label">
                      2H-heavy
                    </th>
                  ) : null}
                  <th className="batch-group-label">Stake</th>
                  <th className="batch-group-label" title="Closing odds">
                    Close
                  </th>
                  <th className="batch-group-label">Early</th>
                  <th colSpan={2} className="batch-group-label">
                    Shots
                  </th>
                  <th colSpan={2} className="batch-group-label">
                    SOT
                  </th>
                  <th colSpan={2} className="batch-group-label">
                    Fouls
                  </th>
                  <th colSpan={2} className="batch-group-label">
                    Yel
                  </th>
                  <th colSpan={2} className="batch-group-label">
                    Red
                  </th>
                  <th colSpan={2} className="batch-group-label">
                    Poss
                  </th>
                  <th colSpan={2} className="batch-group-label">
                    Off
                  </th>
                  <th className="batch-group-label">1st</th>
                  <th colSpan={2} className="batch-group-label">
                    Pen
                  </th>
                  <th className="batch-group-label">Abn</th>
                </tr>
              ) : (
                <tr className="batch-group-headers">
                  <th className="batch-col-frozen" colSpan={4} />
                  <th colSpan={2} className="batch-group-label">
                    Pick
                  </th>
                  <th className="batch-group-label batch-group-ft" colSpan={1}>
                    FT
                  </th>
                  <th colSpan={2} className="batch-group-label batch-group-ht">
                    HT
                  </th>
                  <th colSpan={2} className="batch-group-label">
                    Half Σ
                  </th>
                  <th colSpan={2} className="batch-group-label">
                    Cor
                  </th>
                  <th colSpan={6} className="batch-group-label">
                    Goal timing
                  </th>
                  <th colSpan={2} />
                  {showTwoH ? (
                    <th colSpan={5} className="batch-group-label">
                      2H-heavy
                    </th>
                  ) : null}
                </tr>
              )}
              <tr>
                <th className="batch-col-frozen batch-col-num">#</th>
                <th className="batch-col-frozen batch-col-league">League</th>
                <th className="batch-col-frozen batch-col-team batch-col-home">Home</th>
                <th className="batch-col-frozen batch-col-team batch-col-away">Away</th>
                <th>Market</th>
                <th className="batch-col-pick-secondary">Pick</th>
                <th>Score (H–A)</th>
                <th title="Half-time score">HT (H–A)</th>
                <th title="Match 1H total goals">1H Σ</th>
                <th title="Match 2H total goals">2H Σ</th>
                <th title="Corners">Cor (H–A)</th>
                <th title="Goals 0–15 min">0–15</th>
                <th title="Goals 16–30 min">16–30</th>
                <th title="Goals 31–45 min">31–45</th>
                <th title="Goals 46–60 min">46–60</th>
                <th title="Goals 61–75 min">61–75</th>
                <th title="Goals 76–90+ min">76–90+</th>
                <th>Outcome</th>
                <th aria-label="Result mark" />
                {showTwoH ? (
                  <>
                    <th title="P(2H total goals > 1H)">P(2H&gt;1H)</th>
                    <th title="Confidence (tiebreak)">Conf</th>
                    <th title="Expected 1H goals">E[1H]</th>
                    <th title="Expected 2H goals">E[2H]</th>
                    <th title="Data source">Src</th>
                  </>
                ) : null}
                {showFullStats ? (
                  <>
                    <th>Stake</th>
                    <th title="Closing odds (optional, for CLV)">Close</th>
                    <th>Y/N</th>
                    <th>H</th>
                    <th>A</th>
                    <th>H</th>
                    <th>A</th>
                    <th>H</th>
                    <th>A</th>
                    <th>H</th>
                    <th>A</th>
                    <th>H</th>
                    <th>A</th>
                    <th>H</th>
                    <th>A</th>
                    <th>H</th>
                    <th>A</th>
                    <th>H</th>
                    <th>A</th>
                    <th>H/A</th>
                    <th>H</th>
                    <th>A</th>
                    <th>✓</th>
                  </>
                ) : null}
              </tr>
            </>
          )}
        </thead>
        <tbody>
          {displayMatches.map((match, i) =>
            mode === "entry" ? (
              <BatchEntryRow
                key={match.id}
                index={i}
                match={match}
                defaultLeague={defaultLeague}
                date={date}
                comboSettings={comboSettings!}
                bankrollStrategy={bankrollStrategy}
                teamsQuality={teamsQuality}
                canDelete={matches.length > 1}
                homeRef={cellRefs[i]![0] as React.RefObject<HTMLInputElement | null>}
                awayRef={cellRefs[i]![1] as React.RefObject<HTMLInputElement | null>}
                marketRef={cellRefs[i]![2] as React.RefObject<HTMLSelectElement | null>}
                oddsRef={cellRefs[i]![3] as React.RefObject<HTMLInputElement | null>}
                onChange={(m) => updateMatchById(match.id, m)}
                onDelete={() => deleteMatchById(match.id)}
                onCellKeyDown={(e, col) => handleEntryKeyDown(e, i, col)}
              />
            ) : (
              <BatchResultRow
                key={match.id}
                index={i}
                match={match}
                league={matchLeague(match, defaultLeague)}
                showFullStats={showFullStats}
                expanded={expandedRow === match.id}
                onToggleExpand={() =>
                  setExpandedRow(expandedRow === match.id ? null : match.id)
                }
                cellRefs={cellRefs[i]! as FocusableRef[]}
                fields={resultFields}
                onChange={(m) => updateMatchById(match.id, m)}
                onCellKeyDown={(e, field) => handleResultKeyDown(e, i, field)}
                twoHHeavy={twoHHeavyByMatch?.[match.id] ?? null}
                showTwoHHeavy={showTwoH}
                twoHHeavyTop={topFiveIds.has(match.id)}
              />
            )
          )}
        </tbody>
      </table>
      {mode === "entry" && onAddMatch ? (
        <div className="batch-table-footer">
          <button type="button" className="btn btn-secondary" onClick={onAddMatch}>
            + Add match
          </button>
        </div>
      ) : null}
    </div>
  );
}
