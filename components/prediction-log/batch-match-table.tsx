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
import type { TeamsQualityStore } from "@/lib/prediction-log/teams-quality-types";

interface BatchMatchTableProps {
  mode: "entry" | "result";
  matches: LogMatch[];
  league: string;
  date?: string;
  comboSettings?: CombinedOddsSettings;
  bankrollStrategy?: BankrollStrategySettings;
  teamsQuality?: TeamsQualityStore | null;
  betterAltByMatch?: Record<string, FrozenBetterAlternative>;
  onChange: (matches: LogMatch[]) => void;
  onAddMatch?: () => void;
  /** Used when paste needs more rows than currently exist. */
  createEmptyMatch?: () => LogMatch;
}

/** Focusable entry cells: Home, Away, Market, Odds, Stake. */
const ENTRY_COLS = 5;

type FocusableRef = React.RefObject<
  HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null
>;

export function BatchMatchTable({
  mode,
  matches,
  league,
  date = "",
  comboSettings,
  bankrollStrategy,
  teamsQuality = null,
  betterAltByMatch,
  onChange,
  onAddMatch,
  createEmptyMatch,
}: BatchMatchTableProps) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [showFullStats, setShowFullStats] = useState(false);
  const resultFields = useMemo(
    () => resultEditableFields(showFullStats),
    [showFullStats]
  );
  const colCount = mode === "entry" ? ENTRY_COLS : resultFields.length;
  const rowKeys = matches.map((m) => m.id).join("|");

  const cellRefs = useMemo(() => {
    return matches.map(() =>
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
        else if (row < matches.length - 1) focusCell(row + 1, 0);
        else if (onAddMatch) {
          onAddMatch();
          setTimeout(() => focusCell(matches.length, 0), 0);
        }
        return;
      }
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        if (col > 0) focusCell(row, col - 1);
        else if (row > 0) focusCell(row - 1, ENTRY_COLS - 1);
        return;
      }
      if (e.key === "Enter" && col === ENTRY_COLS - 1 && row === matches.length - 1) {
        e.preventDefault();
        onAddMatch?.();
        setTimeout(() => focusCell(matches.length, 0), 0);
      }
    },
    [focusCell, matches.length, onAddMatch]
  );

  const handleResultKeyDown = useCallback(
    (e: React.KeyboardEvent, row: number, field: ResultGridField) => {
      const col = resultFields.indexOf(field);
      if (col < 0) return;
      const lastCol = resultFields.length - 1;

      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        if (col < lastCol) focusCell(row, col + 1);
        else if (row < matches.length - 1) focusCell(row + 1, 0);
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
        if (row < matches.length - 1) focusCell(row + 1, col);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (col < lastCol) focusCell(row, col + 1);
        else if (row < matches.length - 1) focusCell(row + 1, 0);
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
        if (row < matches.length - 1) focusCell(row + 1, col);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (row > 0) focusCell(row - 1, col);
      }
    },
    [focusCell, matches.length, resultFields]
  );

  function withAltGrade(match: LogMatch): LogMatch {
    const alt = betterAltByMatch?.[match.id];
    if (!alt) return match;
    return gradeMatchFromFacts(match, { betterAlternative: alt });
  }

  function updateMatch(i: number, match: LogMatch) {
    onChange(matches.map((m, idx) => (idx === i ? withAltGrade(match) : m)));
  }

  function deleteMatch(i: number) {
    if (matches.length <= 1) return;
    onChange(matches.filter((_, idx) => idx !== i));
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
      const idx = rowIndex + i;
      if (idx >= next.length) break;
      next[idx] = withAltGrade(applyResultPastePatch(next[idx]!, patches[i]!));
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
              <th>Stake</th>
              <th className="batch-col-pick-secondary">System Pick</th>
              <th style={{ textAlign: "right" }}>Prob %</th>
              <th />
            </tr>
          ) : (
            <>
              {showFullStats ? (
                <tr className="batch-group-headers">
                  <th className="batch-col-frozen" colSpan={4} />
                  <th colSpan={2} className="batch-group-label">
                    Pick
                  </th>
                  <th className="batch-group-label">Stake</th>
                  <th className="batch-group-label" title="Closing odds">
                    Close
                  </th>
                  <th className="batch-group-label batch-group-ft" colSpan={1}>
                    Score
                  </th>
                  <th colSpan={2} />
                  <th colSpan={2} className="batch-group-label batch-group-ht">
                    HT
                  </th>
                  <th className="batch-group-label">Early</th>
                  <th colSpan={2} className="batch-group-label">
                    Shots
                  </th>
                  <th colSpan={2} className="batch-group-label">
                    SOT
                  </th>
                  <th colSpan={2} className="batch-group-label">
                    Corners
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
              ) : null}
              <tr>
                <th className="batch-col-frozen batch-col-num">#</th>
                <th className="batch-col-frozen batch-col-league">League</th>
                <th className="batch-col-frozen batch-col-team batch-col-home">Home</th>
                <th className="batch-col-frozen batch-col-team batch-col-away">Away</th>
                <th>Market</th>
                <th className="batch-col-pick-secondary">Pick</th>
                <th>Stake</th>
                <th title="Closing odds (optional, for CLV)">Close</th>
                <th>Score (H–A)</th>
                <th>Outcome</th>
                <th />
                {showFullStats ? (
                  <>
                    <th>H</th>
                    <th>A</th>
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
          {matches.map((match, i) =>
            mode === "entry" ? (
              <BatchEntryRow
                key={match.id}
                index={i}
                match={match}
                league={league}
                date={date}
                comboSettings={comboSettings!}
                bankrollStrategy={bankrollStrategy}
                teamsQuality={teamsQuality}
                canDelete={matches.length > 1}
                homeRef={cellRefs[i]![0] as React.RefObject<HTMLInputElement | null>}
                awayRef={cellRefs[i]![1] as React.RefObject<HTMLInputElement | null>}
                marketRef={cellRefs[i]![2] as React.RefObject<HTMLSelectElement | null>}
                oddsRef={cellRefs[i]![3] as React.RefObject<HTMLInputElement | null>}
                stakeRef={cellRefs[i]![4] as React.RefObject<HTMLInputElement | null>}
                onChange={(m) => updateMatch(i, m)}
                onDelete={() => deleteMatch(i)}
                onCellKeyDown={(e, col) => handleEntryKeyDown(e, i, col)}
              />
            ) : (
              <BatchResultRow
                key={match.id}
                index={i}
                match={match}
                league={league}
                showFullStats={showFullStats}
                expanded={expandedRow === i}
                onToggleExpand={() => setExpandedRow(expandedRow === i ? null : i)}
                cellRefs={cellRefs[i]! as FocusableRef[]}
                fields={resultFields}
                onChange={(m) => updateMatch(i, m)}
                onCellKeyDown={(e, field) => handleResultKeyDown(e, i, field)}
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
