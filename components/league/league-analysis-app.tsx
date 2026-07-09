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
import type { League } from "@/lib/prediction-log/types";

export function LeagueAnalysisApp() {
  const { ready, leagueProfiles, learnerStats, refresh } = usePredictionLogData();
  const metas = useMemo(() => allLeagueMetas(), []);
  const seasons = useMemo(() => {
    const set = new Set<string>();
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
      </div>

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
          No profile for this league and season yet. Save match results on prediction batches to build it.
        </p>
      )}
    </div>
  );
}
