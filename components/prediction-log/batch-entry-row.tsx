"use client";

import { useMemo } from "react";
import { useMatchEntryProbability } from "./use-match-entry-probability";
import { useSystemPickLabel } from "./use-system-pick-label";
import { TeamAutocompleteCell } from "./team-autocomplete-cell";
import {
  applyMarketOption,
  buildMarketOptions,
  findMarketOption,
  marketOptionFromMatch,
} from "@/lib/prediction-log/batch-market-options";
import { resolveMarketMode } from "@/lib/prediction-log/match-entry-helpers";
import type { CombinedOddsSettings, LogMatch } from "@/lib/prediction-log/types";
import type { TeamsQualityStore } from "@/lib/prediction-log/teams-quality-types";

function probClass(p: number | null): string {
  if (p == null) return "";
  if (p >= 65) return "batch-prob-high";
  if (p >= 50) return "batch-prob-mid";
  return "batch-prob-low";
}

interface BatchEntryRowProps {
  index: number;
  match: LogMatch;
  league: string;
  date: string;
  comboSettings: CombinedOddsSettings;
  teamsQuality: TeamsQualityStore | null;
  canDelete: boolean;
  homeRef?: React.RefObject<HTMLInputElement | null>;
  awayRef?: React.RefObject<HTMLInputElement | null>;
  marketRef?: React.RefObject<HTMLSelectElement | null>;
  oddsRef?: React.RefObject<HTMLInputElement | null>;
  onChange: (match: LogMatch) => void;
  onDelete: () => void;
  onCellKeyDown?: (e: React.KeyboardEvent, col: number) => void;
}

export function BatchEntryRow({
  index,
  match,
  league,
  date,
  comboSettings,
  teamsQuality,
  canDelete,
  homeRef,
  awayRef,
  marketRef,
  oddsRef,
  onChange,
  onDelete,
  onCellKeyDown,
}: BatchEntryRowProps) {
  const options = useMemo(
    () =>
      buildMarketOptions(
        match.homeTeam,
        match.awayTeam,
        comboSettings,
        comboSettings.showSingleMarkets,
        comboSettings.showCombinedMarkets
      ),
    [match.homeTeam, match.awayTeam, comboSettings]
  );
  const selectedValue = marketOptionFromMatch(match, match.homeTeam, match.awayTeam);
  const prob = useMatchEntryProbability(match, league, date);
  const systemPick = useSystemPickLabel(match, league, date, comboSettings);
  const mode = resolveMarketMode(match);

  function updateOdds(raw: string) {
    const odds = parseFloat(raw);
    if (mode === "combined") {
      onChange({
        ...match,
        comboPick: {
          comboId: match.comboPick?.comboId ?? "",
          odds: Number.isFinite(odds) ? odds : 0,
        },
      });
      return;
    }
    const keys = Object.keys(match.predictions);
    if (keys.length !== 1) return;
    const key = keys[0] as keyof typeof match.predictions;
    onChange({
      ...match,
      predictions: {
        ...match.predictions,
        [key]: { ...match.predictions[key]!, odds: Number.isFinite(odds) ? odds : undefined },
      },
    });
  }

  const oddsValue =
    mode === "combined"
      ? match.comboPick?.odds && match.comboPick.odds > 0
        ? String(match.comboPick.odds)
        : ""
      : (() => {
          const keys = Object.keys(match.predictions);
          if (keys.length !== 1) return "";
          const o = match.predictions[keys[0] as keyof typeof match.predictions]?.odds;
          return o != null && o > 0 ? String(o) : "";
        })();

  return (
    <tr>
      <td className="batch-col-frozen batch-col-num">{index + 1}</td>
      <td className="batch-col-frozen batch-col-team batch-col-home">
        <TeamAutocompleteCell
          value={match.homeTeam}
          league={league}
          teamsQuality={teamsQuality}
          placeholder="Home"
          inputRef={homeRef}
          onChange={(homeTeam) => onChange({ ...match, homeTeam })}
          onKeyDown={(e) => onCellKeyDown?.(e, 0)}
        />
      </td>
      <td className="batch-col-frozen batch-col-team batch-col-away">
        <TeamAutocompleteCell
          value={match.awayTeam}
          league={league}
          teamsQuality={teamsQuality}
          placeholder="Away"
          inputRef={awayRef}
          onChange={(awayTeam) => onChange({ ...match, awayTeam })}
          onKeyDown={(e) => onCellKeyDown?.(e, 1)}
        />
      </td>
      <td className="batch-col-market">
        <select
          ref={marketRef}
          value={selectedValue}
          onChange={(e) => {
            const opt = findMarketOption(options, e.target.value);
            if (opt) onChange(applyMarketOption(match, opt));
          }}
          onKeyDown={(e) => onCellKeyDown?.(e, 2)}
        >
          <option value="">Market…</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </td>
      <td className="batch-col-odds">
        <input
          ref={oddsRef}
          type="number"
          min={1}
          max={3}
          step={0.01}
          placeholder="Odds"
          value={oddsValue}
          onChange={(e) => updateOdds(e.target.value)}
          onKeyDown={(e) => onCellKeyDown?.(e, 3)}
        />
      </td>
      <td className="batch-col-pick batch-col-pick-secondary" title={systemPick.label}>
        {systemPick.loading ? "…" : systemPick.label}
      </td>
      <td className={`batch-col-prob ${probClass(prob.pGrid)}`}>
        {prob.loading ? "…" : prob.pGrid != null ? `${prob.pGrid}%` : "—"}
      </td>
      <td className="batch-col-actions">
        {canDelete ? (
          <button
            type="button"
            className="batch-delete-btn"
            tabIndex={-1}
            title="Remove match"
            onClick={onDelete}
          >
            ×
          </button>
        ) : null}
      </td>
    </tr>
  );
}
