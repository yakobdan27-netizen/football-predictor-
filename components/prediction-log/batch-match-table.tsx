"use client";

import { useCallback, useMemo, useState } from "react";
import { parsePastedRows } from "@/lib/prediction-log/parse-pasted-rows";
import { BatchEntryRow } from "./batch-entry-row";
import { BatchResultRow } from "./batch-result-row";
import type { CombinedOddsSettings, LogMatch } from "@/lib/prediction-log/types";
import type { TeamsQualityStore } from "@/lib/prediction-log/teams-quality-types";

interface BatchMatchTableProps {
  mode: "entry" | "result";
  matches: LogMatch[];
  league: string;
  date?: string;
  comboSettings?: CombinedOddsSettings;
  teamsQuality?: TeamsQualityStore | null;
  onChange: (matches: LogMatch[]) => void;
  onAddMatch?: () => void;
}

const ENTRY_COLS = 4;
const RESULT_COLS = 2;

export function BatchMatchTable({
  mode,
  matches,
  league,
  date = "",
  comboSettings,
  teamsQuality = null,
  onChange,
  onAddMatch,
}: BatchMatchTableProps) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const colCount = mode === "entry" ? ENTRY_COLS : RESULT_COLS;
  const rowKeys = matches.map((m) => m.id).join("|");

  const cellRefs = useMemo(() => {
    return matches.map(() =>
      Array.from({ length: colCount }, () => ({ current: null as HTMLInputElement | HTMLSelectElement | null }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild when row count/ids change
  }, [rowKeys, colCount]);

  const focusCell = useCallback((row: number, col: number) => {
    const ref = cellRefs[row]?.[col];
    ref?.current?.focus();
  }, [cellRefs]);

  const handleCellKeyDown = useCallback(
    (e: React.KeyboardEvent, row: number, col: number, colCount: number) => {
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        if (col < colCount - 1) {
          focusCell(row, col + 1);
        } else if (row < matches.length - 1) {
          focusCell(row + 1, 0);
        } else if (mode === "entry" && onAddMatch) {
          onAddMatch();
          setTimeout(() => focusCell(matches.length, 0), 0);
        }
        return;
      }
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        if (col > 0) {
          focusCell(row, col - 1);
        } else if (row > 0) {
          focusCell(row - 1, colCount - 1);
        }
        return;
      }
      if (e.key === "Enter" && mode === "entry" && col === colCount - 1 && row === matches.length - 1) {
        e.preventDefault();
        onAddMatch?.();
        setTimeout(() => focusCell(matches.length, 0), 0);
      }
      if (e.key === "Enter" && mode === "result" && col === 1) {
        e.preventDefault();
        if (row < matches.length - 1) {
          focusCell(row + 1, 0);
        }
      }
    },
    [focusCell, matches.length, mode, onAddMatch]
  );

  function updateMatch(i: number, match: LogMatch) {
    onChange(matches.map((m, idx) => (idx === i ? match : m)));
  }

  function deleteMatch(i: number) {
    if (matches.length <= 1) return;
    onChange(matches.filter((_, idx) => idx !== i));
  }

  function handlePaste(e: React.ClipboardEvent) {
    if (mode !== "entry") return;
    const text = e.clipboardData.getData("text");
    if (!text.includes("\t") && !text.includes("\n") && !text.includes(",")) return;
    const rows = parsePastedRows(text);
    if (rows.length === 0) return;
    e.preventDefault();

    const target = e.target as HTMLElement;
    const tr = target.closest("tr");
    const tbody = tr?.parentElement;
    const rowIndex = tr && tbody ? Array.from(tbody.children).indexOf(tr) : 0;

    const next = [...matches];
    for (let i = 0; i < rows.length; i++) {
      const idx = rowIndex + i;
      if (idx >= next.length) break;
      next[idx] = {
        ...next[idx]!,
        homeTeam: rows[i]!.home,
        awayTeam: rows[i]!.away,
      };
    }
    onChange(next);
  }

  if (mode === "entry" && !comboSettings) return null;

  return (
    <div className="batch-table-wrap" onPaste={handlePaste}>
      <table className="batch-table">
        <thead>
          {mode === "entry" ? (
            <tr>
              <th className="batch-col-frozen batch-col-num" style={{ left: 0 }}>
                #
              </th>
              <th className="batch-col-frozen batch-col-team" style={{ left: "2.25rem" }}>
                Home
              </th>
              <th className="batch-col-frozen batch-col-team" style={{ left: "11.75rem" }}>
                Away
              </th>
              <th>Market</th>
              <th>Odds</th>
              <th>System Pick</th>
              <th style={{ textAlign: "right" }}>Prob</th>
              <th />
            </tr>
          ) : (
            <tr>
              <th className="batch-col-frozen batch-col-num" style={{ left: 0 }}>
                #
              </th>
              <th className="batch-col-frozen batch-col-team" style={{ left: "2.25rem" }}>
                Home
              </th>
              <th className="batch-col-frozen batch-col-team" style={{ left: "11.75rem" }}>
                Away
              </th>
              <th>Market</th>
              <th>Pick</th>
              <th>H</th>
              <th>A</th>
              <th>Outcome</th>
              <th />
            </tr>
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
                teamsQuality={teamsQuality}
                canDelete={matches.length > 1}
                homeRef={cellRefs[i]![0] as React.RefObject<HTMLInputElement | null>}
                awayRef={cellRefs[i]![1] as React.RefObject<HTMLInputElement | null>}
                marketRef={cellRefs[i]![2] as React.RefObject<HTMLSelectElement | null>}
                oddsRef={cellRefs[i]![3] as React.RefObject<HTMLInputElement | null>}
                onChange={(m) => updateMatch(i, m)}
                onDelete={() => deleteMatch(i)}
                onCellKeyDown={(e, col) => handleCellKeyDown(e, i, col, ENTRY_COLS)}
              />
            ) : (
              <BatchResultRow
                key={match.id}
                index={i}
                match={match}
                expanded={expandedRow === i}
                onToggleExpand={() => setExpandedRow(expandedRow === i ? null : i)}
                homeScoreRef={cellRefs[i]![0] as React.RefObject<HTMLInputElement | null>}
                awayScoreRef={cellRefs[i]![1] as React.RefObject<HTMLInputElement | null>}
                onChange={(m) => updateMatch(i, m)}
                onCellKeyDown={(e, col) => handleCellKeyDown(e, i, col, RESULT_COLS)}
              />
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
