"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LEAGUE_OPTIONS } from "@/lib/prediction-log/markets-config";
import {
  addTeamQuality,
  fetchTeamsQuality,
  importTeamsQuality,
} from "@/lib/prediction-log/storage";
import {
  boostVsDLabel,
  exportTeamsCsv,
  qualityLabelForTier,
  tierSummaryCounts,
} from "@/lib/prediction-log/teams-quality";
import {
  buildStagingRows,
  filterStagingRows,
  type StagingTeamRow,
} from "@/lib/prediction-log/teams-quality-roster";
import type { QualityTier, TeamsQualityStore } from "@/lib/prediction-log/teams-quality-types";

const TIERS: QualityTier[] = ["A", "B", "C", "D"];

function TierBadge({ tier, color }: { tier: QualityTier; color?: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.1rem 0.45rem",
        borderRadius: "6px",
        fontSize: "0.75rem",
        fontWeight: 700,
        background: color ?? "var(--surface2)",
        color: "var(--text)",
      }}
    >
      {tier}
    </span>
  );
}

export function TeamsQualityApp() {
  const [store, setStore] = useState<TeamsQualityStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<QualityTier | "all">("all");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTier, setNewTier] = useState<QualityTier>("C");
  const [newLeague, setNewLeague] = useState<string>(LEAGUE_OPTIONS[0]);
  const [importText, setImportText] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTeamsQuality();
      setStore(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load teams");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const stagingRows = useMemo(() => buildStagingRows(store), [store]);

  const filteredTeams = useMemo(
    () => filterStagingRows(stagingRows, tierFilter, search),
    [stagingRows, tierFilter, search]
  );

  const summary = useMemo(() => (store ? tierSummaryCounts(store) : null), [store]);

  async function handleTierChange(row: StagingTeamRow, tier: QualityTier) {
    setSaving(true);
    setError(null);
    try {
      const saved = await addTeamQuality(row.team_name, tier);
      setStore(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update tier");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddTeam() {
    if (!newName.trim() || !newLeague) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await addTeamQuality(newName.trim(), newTier, newLeague);
      setStore(saved);
      setNewName("");
      setShowAdd(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add team");
    } finally {
      setSaving(false);
    }
  }

  async function handleImport() {
    setSaving(true);
    setError(null);
    try {
      const saved = await importTeamsQuality(importText, "merge");
      setStore(saved);
      setImportText("");
      setShowImport(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setSaving(false);
    }
  }

  function handleExport() {
    if (!store) return;
    const blob = new Blob([exportTeamsCsv(store)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "teams-quality.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <p style={{ color: "var(--muted)" }}>Loading teams…</p>;
  }

  return (
    <div>
      <div
        className="card"
        style={{ marginBottom: "1rem", background: "rgba(255,255,255,0.02)" }}
      >
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--muted)" }}>
          Manual tier assignment for prediction boost. Custom teams require a league so they
          appear in New Batch autocomplete and pass fixture validation like registered clubs.
          Higher-tier vs lower-tier matchups get a tier-gap boost on P_final.
        </p>
      </div>

      {error && (
        <p style={{ color: "var(--danger)", marginBottom: "1rem", fontSize: "0.875rem" }}>
          {error}
        </p>
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          marginBottom: "1rem",
          alignItems: "center",
        }}
      >
        <button type="button" className="btn" onClick={handleExport} disabled={!store?.teams.length}>
          Export Teams
        </button>
        <button type="button" className="btn" onClick={() => setShowImport(true)}>
          Import
        </button>
        {saving && (
          <span style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>Saving…</span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          marginBottom: "1rem",
          alignItems: "center",
        }}
      >
        <label style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
          Filter:
          <select
            className="select"
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value as QualityTier | "all")}
            style={{ marginLeft: "0.5rem" }}
          >
            <option value="all">All</option>
            {TIERS.map((tier) => (
              <option key={tier} value={tier}>
                Tier {tier}
              </option>
            ))}
          </select>
        </label>
        <input
          className="input"
          placeholder="Search teams…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: "240px" }}
        />
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "0.5rem" }}>#</th>
              <th style={{ padding: "0.5rem" }}>Team Name</th>
              <th style={{ padding: "0.5rem" }}>League</th>
              <th style={{ padding: "0.5rem" }}>Tier</th>
              <th style={{ padding: "0.5rem" }}>Quality Boost</th>
            </tr>
          </thead>
          <tbody>
            {filteredTeams.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: "1rem", color: "var(--muted)" }}>
                  No teams match your filter. Try a different tier or search term.
                </td>
              </tr>
            ) : (
              filteredTeams.map((team, idx) => (
                <tr
                  key={team.team_id}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    opacity: team.inStore ? 1 : 0.85,
                  }}
                >
                  <td style={{ padding: "0.5rem", color: "var(--muted)" }}>{idx + 1}</td>
                  <td style={{ padding: "0.5rem", fontWeight: 600 }}>
                    {team.team_name}
                    {team.isCustom && (
                      <span style={{ marginLeft: "0.35rem", fontSize: "0.7rem", color: "var(--muted)" }}>
                        custom
                      </span>
                    )}
                    {!team.inStore && (
                      <span style={{ marginLeft: "0.35rem", fontSize: "0.7rem", color: "var(--muted)" }}>
                        not saved
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "0.5rem", fontSize: "0.8125rem", color: "var(--muted)" }}>
                    {team.isCustom
                      ? team.leagues.length
                        ? team.leagues.join(", ")
                        : "—"
                      : "—"}
                  </td>
                  <td style={{ padding: "0.5rem" }}>
                    <select
                      className="select"
                      value={team.tier}
                      onChange={(e) =>
                        void handleTierChange(team, e.target.value as QualityTier)
                      }
                      style={{ minWidth: "4rem" }}
                    >
                      {TIERS.map((tier) => (
                        <option key={tier} value={tier}>
                          {tier}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: "0.5rem", color: "var(--muted)" }}>
                    {store && team.inStore ? boostVsDLabel(team.tier, store) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>
        <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
          + Add Team
        </button>
        <span style={{ marginLeft: "0.75rem", fontSize: "0.8125rem", color: "var(--muted)" }}>
          {stagingRows.length} teams listed · {store?.teams.length ?? 0} tier assignments saved
        </span>
      </div>

      {summary && store && (
        <div className="card" style={{ marginTop: "1.5rem" }}>
          <h3 style={{ fontSize: "1rem", margin: "0 0 0.75rem" }}>Tier Summary</h3>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {TIERS.map((tier) => (
              <div
                key={tier}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  fontSize: "0.875rem",
                }}
              >
                <TierBadge tier={tier} color={store.tier_config[tier]?.color} />
                <span>
                  {summary[tier]} team{summary[tier] === 1 ? "" : "s"}
                </span>
                <span style={{ color: "var(--muted)" }}>
                  Quality: {qualityLabelForTier(tier, store.tier_config)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showAdd && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: "1rem",
          }}
          onClick={() => setShowAdd(false)}
        >
          <div className="card" style={{ maxWidth: "420px", width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Add New Team</h3>
            <label className="label" style={{ display: "block", marginBottom: "0.75rem" }}>
              Team Name
              <input
                className="input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{ marginTop: "0.35rem", width: "100%" }}
              />
            </label>
            <label className="label" style={{ display: "block", marginBottom: "0.75rem" }}>
              League
              <select
                className="select"
                value={newLeague}
                onChange={(e) => setNewLeague(e.target.value)}
                style={{ marginTop: "0.35rem", width: "100%" }}
              >
                {LEAGUE_OPTIONS.map((league) => (
                  <option key={league} value={league}>
                    {league}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ marginBottom: "1rem" }}>
              <div className="label" style={{ marginBottom: "0.35rem" }}>
                Quality Tier
              </div>
              {TIERS.map((tier) => (
                <label
                  key={tier}
                  style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}
                >
                  <input
                    type="radio"
                    name="new-tier"
                    checked={newTier === tier}
                    onChange={() => setNewTier(tier)}
                  />
                  Tier {tier} — {store ? qualityLabelForTier(tier, store.tier_config) : tier}
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleAddTeam()}
                disabled={!newName.trim() || !newLeague || saving}
              >
                Add Team
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: "1rem",
          }}
          onClick={() => setShowImport(false)}
        >
          <div className="card" style={{ maxWidth: "480px", width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Import Teams</h3>
            <p style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
              Format: team_name,tier — e.g. Arsenal,A
            </p>
            <textarea
              className="input"
              rows={8}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={"Arsenal,A\nBrighton,B\nWolves,C"}
              style={{ width: "100%", marginBottom: "1rem", fontFamily: "monospace" }}
            />
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setShowImport(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleImport()}
                disabled={!importText.trim() || saving}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
