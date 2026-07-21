"use client";

import { useMemo, useState } from "react";
import { allLeagueMetas } from "@/lib/prediction-log/league-registry";
import { leagueProfileKey, seasonForDate, seasonForYear } from "@/lib/prediction-log/season";
import { usePredictionLogData } from "@/components/prediction-log/use-prediction-log-data";
import { LeagueFingerprintCard } from "./league-fingerprint-card";
import { LeagueTraitTables } from "./league-trait-tables";
import { GoalTimingChart } from "./goal-timing-chart";
import { LeagueOverridePanel } from "./league-override-panel";
import { LeagueEngineImpact } from "./league-engine-impact";
import { LeagueMatchupCard } from "./league-matchup-card";
import { LeaguePriorsCard } from "./league-priors-card";
import type { League } from "@/lib/prediction-log/types";

export function LeagueAnalysisApp() {
  const { ready, leagueProfiles, leaguePriors, learnerStats, refresh } = usePredictionLogData();
  const metas = useMemo(() => allLeagueMetas(), []);
  const seasons = useMemo(() => {
    const set = new Set<string>(["2025/26", "2024/25", "2023/24", "2022/23", "2021/22"]);
    for (const key of Object.keys(leagueProfiles?.leagues ?? {})) {
      const season = key.split("::")[1];
      if (season) set.add(season);
    }
    set.add(seasonForDate(new Date().toISOString().slice(0, 10)));
    set.add(seasonForYear(2026));
    return [...set].sort().reverse();
  }, [leagueProfiles]);

  const [leagueId, setLeagueId] = useState(metas[0]?.leagueId ?? "premier_league");
  const [season, setSeason] = useState(seasons[0] ?? seasonForDate(new Date().toISOString().slice(0, 10)));

  const league: League | null = leagueProfiles?.leagues[leagueProfileKey(leagueId, season)] ?? null;

  if (!ready) {
    return <p className="page-sub">Loading league profiles…</p>;
  }

  return (
    <div>
      <div
        className="card"
        style={{
          marginBottom: "1rem",
          display: "flex",
          flexWrap: "wrap",
          gap: "1rem",
          alignItems: "flex-end",
        }}
      >
        <div>
          <label className="label">League</label>
          <select className="input" value={leagueId} onChange={(e) => setLeagueId(e.target.value)}>
            {metas.map((m) => (
              <option key={m.leagueId} value={m.leagueId}>
                {m.leagueName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Season</label>
          <select className="input" value={season} onChange={(e) => setSeason(e.target.value)}>
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void refresh()}>
          Refresh profiles
        </button>
        {league?.dataSource ? (
          <span
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              padding: "0.25rem 0.55rem",
              borderRadius: 4,
              alignSelf: "center",
              background:
                league.dataSource === "seed"
                  ? "color-mix(in srgb, var(--accent2) 20%, transparent)"
                  : league.dataSource === "blended"
                    ? "color-mix(in srgb, var(--accent) 18%, transparent)"
                    : "transparent",
              color:
                league.dataSource === "live" ? "var(--muted)" : "inherit",
              border: league.dataSource === "live" ? "1px solid var(--border, #333)" : undefined,
            }}
          >
            {league.dataSource === "seed"
              ? "Seed prior (2021–26)"
              : league.dataSource === "blended"
                ? "Seed + live results"
                : "Live results"}
          </span>
        ) : null}
      </div>

      <LeagueMatchupCard />

      <LeaguePriorsCard
        store={leaguePriors}
        onRecompute={() => {
          void fetch("/api/league-priors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recompute: true }),
          }).then(() => refresh());
        }}
      />

      {league ? (
        <>
          <LeagueFingerprintCard
            league={league}
            correctScoreStats={learnerStats?.correctScoreStats}
          />
          <div className="card" style={{ marginBottom: "1rem" }}>
            <h3 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "0.75rem" }}>
              Goal timing curve
            </h3>
            <GoalTimingChart curve={league.characterProfile.goal_timing_curve} />
          </div>
          <LeagueTraitTables league={league} />
          <LeagueOverridePanel
            league={league}
            onUpdate={() => {
              void refresh();
            }}
          />
          <LeagueEngineImpact league={league} />
        </>
      ) : (
        <p className="page-sub">
          No seed or live profile for this league and season. Top-5 leagues (PL, La Liga, Serie A,
          Ligue 1) initialize from 2021–26 seeds after refresh; other leagues need saved match
          results.
        </p>
      )}
    </div>
  );
}
