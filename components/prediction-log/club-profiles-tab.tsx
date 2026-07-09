"use client";

import { useMemo, useState } from "react";
import { listClubProfiles } from "@/lib/prediction-log/club-profiles";
import { loadClubProfiles } from "@/lib/prediction-log/storage";
import type { ClubProfile, HitStats } from "@/lib/prediction-log/types";

function HitBar({ label, stats }: { label: string; stats: HitStats }) {
  if (stats.sample === 0) return null;
  return (
    <div style={{ marginBottom: "0.35rem", fontSize: "0.8rem" }}>
      <span style={{ color: "var(--muted)" }}>{label}: </span>
      <strong>{stats.pct ?? "—"}%</strong>
      <span style={{ color: "var(--muted)" }}> ({stats.sample} picks)</span>
    </div>
  );
}

function ProfileCard({ profile }: { profile: ClubProfile }) {
  const m = profile.metrics;
  return (
    <div className="card" style={{ marginBottom: "0.75rem" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "baseline" }}>
        <strong>{profile.clubName}</strong>
        <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{profile.league}</span>
        <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          {profile.totalMatches} matches · updated {profile.lastUpdated.slice(0, 10)}
        </span>
      </div>
      <p style={{ fontSize: "0.875rem", marginTop: "0.5rem" }}>{profile.summary}</p>
      {profile.tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.5rem" }}>
          {profile.tags.map((tag) => (
            <span key={tag} className="chip" style={{ fontSize: "0.7rem" }}>
              {tag}
            </span>
          ))}
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "0.75rem",
          marginTop: "0.75rem",
        }}
      >
        <div>
          <div style={{ fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.25rem" }}>Performance</div>
          <HitBar label="1X2" stats={m.result1x2} />
          <HitBar label="BTTS" stats={m.btts} />
          <HitBar label="Goals O/U" stats={m.overUnderGoals} />
          <HitBar label="Double chance" stats={m.doubleChance} />
          <HitBar label="Corners" stats={m.numericLines.corners} />
        </div>
        <div>
          <div style={{ fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.25rem" }}>Venue</div>
          <HitBar label="Home picks" stats={m.homeRecord} />
          <HitBar label="Away picks" stats={m.awayRecord} />
          <HitBar label="High risk (>2.60)" stats={m.highRisk} />
        </div>
      </div>
      {(profile.strengths.length > 0 || profile.weaknesses.length > 0) && (
        <div style={{ marginTop: "0.75rem", fontSize: "0.8rem" }}>
          {profile.strengths.length > 0 && (
            <p style={{ color: "var(--accent)", marginBottom: "0.25rem" }}>
              Strengths: {profile.strengths.join("; ")}
            </p>
          )}
          {profile.weaknesses.length > 0 && (
            <p style={{ color: "var(--warn)" }}>Weaknesses: {profile.weaknesses.join("; ")}</p>
          )}
        </div>
      )}
      {profile.recentMatches.length > 0 && (
        <details style={{ marginTop: "0.75rem" }}>
          <summary style={{ cursor: "pointer", fontSize: "0.8rem" }}>
            Recent matches ({profile.recentMatches.length})
          </summary>
          <ul style={{ paddingLeft: "1.25rem", fontSize: "0.75rem", marginTop: "0.35rem" }}>
            {profile.recentMatches.map((rm, i) => (
              <li key={i}>
                {rm.date} · {rm.venue} vs {rm.opponent}
                {rm.hitRatePct != null ? ` · ${rm.hitRatePct}% hit` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function ClubProfilesTab() {
  const [query, setQuery] = useState("");
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const profiles = useMemo(() => listClubProfiles(loadClubProfiles()), []);

  const leagues = useMemo(
    () => [...new Set(profiles.map((p) => p.league))].sort(),
    [profiles]
  );

  const filtered = profiles.filter((p) => {
    if (leagueFilter !== "all" && p.league !== leagueFilter) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return p.clubName.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q));
  });

  if (profiles.length === 0) {
    return (
      <p className="page-sub">
        No club profiles yet. Save batch results to build team character profiles automatically.
      </p>
    );
  }

  return (
    <div>
      <p className="page-sub" style={{ marginBottom: "1rem" }}>
        Profiles update automatically when you save batch results. They feed into similarity scoring,
        confidence adjustment, and recommended batch judgments.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <input
          className="input"
          placeholder="Search club or tag…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: "220px" }}
        />
        <select
          className="input"
          value={leagueFilter}
          onChange={(e) => setLeagueFilter(e.target.value)}
          style={{ maxWidth: "180px" }}
        >
          <option value="all">All leagues</option>
          {leagues.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {filtered.map((p) => (
        <ProfileCard key={p.id} profile={p} />
      ))}
    </div>
  );
}
