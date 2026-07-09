"use client";

import { useState } from "react";
import { LEAGUE_TRAIT_GROUPS } from "@/lib/prediction-log/league-profiles";
import { saveManualLeagueField } from "@/lib/prediction-log/league-profiles";
import { leagueProfileKey } from "@/lib/prediction-log/season";
import { loadLeagueProfiles, saveLeagueProfiles } from "@/lib/prediction-log/storage";
import type { League, LeagueCharacterProfile, LeagueCharacterTrait } from "@/lib/prediction-log/types";

interface LeagueOverridePanelProps {
  league: League;
  onUpdate: (league: League) => void;
}

export function LeagueOverridePanel({ league, onUpdate }: LeagueOverridePanelProps) {
  const [open, setOpen] = useState(false);

  function saveTrait(key: keyof LeagueCharacterProfile, raw: string) {
    if (key === "goal_timing_curve") return;
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) return;
    const storeKey = leagueProfileKey(league.leagueId, league.season);
    let store = loadLeagueProfiles();
    store = saveManualLeagueField(store, storeKey, key, value);
    saveLeagueProfiles(store);
    const updated = store.leagues[storeKey];
    if (updated) onUpdate(updated);
  }

  return (
    <details
      className="card"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      style={{ marginTop: "1rem" }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Manual trait overrides</summary>
      <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: "0.75rem 0" }}>
        Override computed traits when you have external knowledge. Manual values are preserved on recompute.
      </p>
      <div style={{ display: "grid", gap: "0.75rem" }}>
        {LEAGUE_TRAIT_GROUPS.flatMap((g) => g.traits).map(({ key, label }) => {
          const trait = league.characterProfile[key] as LeagueCharacterTrait;
          return (
            <TraitOverrideRow
              key={key}
              label={label}
              trait={trait}
              onSave={(v) => saveTrait(key, v)}
            />
          );
        })}
      </div>
    </details>
  );
}

function TraitOverrideRow({
  label,
  trait,
  onSave,
}: {
  label: string;
  trait: LeagueCharacterTrait;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState(trait.value != null ? String(trait.value) : "");

  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 200px" }}>
        <label className="label" style={{ fontSize: "0.75rem" }}>
          {label}
        </label>
        <input
          className="input"
          type="number"
          step="any"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
      <button type="button" className="btn btn-secondary" style={{ fontSize: "0.75rem" }} onClick={() => onSave(draft)}>
        Save override
      </button>
    </div>
  );
}
