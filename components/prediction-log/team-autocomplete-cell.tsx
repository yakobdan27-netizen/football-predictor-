"use client";

import { useMemo, useState } from "react";
import { teamsForLeague } from "@/lib/prediction-log/teams";
import { lookupTeam, DEFAULT_TIER_CONFIG } from "@/lib/prediction-log/teams-quality";
import type { TeamsQualityStore } from "@/lib/prediction-log/teams-quality-types";

interface TeamAutocompleteCellProps {
  value: string;
  league: string;
  teamsQuality: TeamsQualityStore | null;
  placeholder?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  tabIndex?: number;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function TeamAutocompleteCell({
  value,
  league,
  teamsQuality,
  placeholder,
  inputRef,
  tabIndex,
  onChange,
  onKeyDown,
}: TeamAutocompleteCellProps) {
  const listId = useMemo(
    () => `teams-${league.replace(/\s/g, "-")}-${placeholder ?? "team"}`,
    [league, placeholder]
  );
  const teams = useMemo(() => teamsForLeague(league), [league]);
  const tier = value ? lookupTeam(teamsQuality, value)?.tier : null;
  const tierColor = tier ? (teamsQuality?.tier_config ?? DEFAULT_TIER_CONFIG)[tier]?.color : undefined;
  const [highlight, setHighlight] = useState(-1);
  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return teams.slice(0, 20);
    return teams.filter((t) => t.toLowerCase().includes(q)).slice(0, 20);
  }, [teams, value]);

  function handleArrow(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && highlight >= 0 && filtered[highlight]) {
      e.preventDefault();
      onChange(filtered[highlight]!);
      setHighlight(-1);
    }
    onKeyDown?.(e);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", minWidth: 0, gap: "0.15rem" }}>
      <input
        ref={inputRef}
        type="text"
        className="batch-team-input"
        value={value}
        list={listId}
        placeholder={placeholder}
        tabIndex={tabIndex}
        title={value || undefined}
        style={{ minWidth: 0, flex: 1 }}
        onChange={(e) => {
          setHighlight(-1);
          onChange(e.target.value);
        }}
        onKeyDown={handleArrow}
      />
      {tier ? (
        <span
          className="batch-tier-chip"
          title={`Tier ${tier}`}
          style={{
            background: `${tierColor ?? "var(--muted)"}22`,
            color: tierColor ?? "var(--muted)",
            border: `1px solid ${tierColor ?? "var(--border)"}`,
          }}
        >
          {tier}
        </span>
      ) : null}
      <datalist id={listId}>
        {teams.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  );
}
