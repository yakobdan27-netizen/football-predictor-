"use client";

import { LEAGUE_TRAIT_GROUPS } from "@/lib/prediction-log/league-profiles";
import type { League, LeagueCharacterTrait } from "@/lib/prediction-log/types";

function formatValue(trait: LeagueCharacterTrait, suffix = ""): string {
  if (trait.value == null) return "—";
  return `${trait.value}${suffix}`;
}

function deltaBadge(delta: number | null) {
  if (delta == null || Math.abs(delta) < 0.01) return <span style={{ color: "var(--muted)" }}>—</span>;
  const up = delta > 0;
  return (
    <span style={{ color: up ? "var(--accent)" : "var(--danger)", fontWeight: 600 }}>
      {up ? "↑" : "↓"} {up ? "+" : ""}
      {delta}
    </span>
  );
}

interface LeagueTraitTablesProps {
  league: League;
}

export function LeagueTraitTables({ league }: LeagueTraitTablesProps) {
  const profile = league.characterProfile;

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {LEAGUE_TRAIT_GROUPS.map((group) => (
        <div key={group.title} className="card">
          <h3 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "0.75rem" }}>{group.title}</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: "0.8125rem", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Trait</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Value</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>vs baseline</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>n</th>
                </tr>
              </thead>
              <tbody>
                {group.traits.map(({ key, label }) => {
                  const trait = profile[key] as LeagueCharacterTrait;
                  const pctSuffix = label.includes("%") ? "%" : "";
                  return (
                    <tr key={key} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.45rem 0.5rem" }}>
                        {label}
                        {trait.manual ? (
                          <span style={{ marginLeft: "0.35rem", fontSize: "0.7rem", color: "var(--warn)" }}>
                            manual
                          </span>
                        ) : null}
                      </td>
                      <td style={{ padding: "0.45rem 0.5rem", fontWeight: 600 }}>
                        {formatValue(trait, pctSuffix)}
                      </td>
                      <td style={{ padding: "0.45rem 0.5rem" }}>{deltaBadge(trait.baselineDelta)}</td>
                      <td style={{ padding: "0.45rem 0.5rem", color: "var(--muted)" }}>{trait.sampleSize}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
