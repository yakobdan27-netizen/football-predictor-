"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { LEAGUE_OPTIONS } from "@/lib/prediction-log/markets-config";
import { matchLeague } from "@/lib/prediction-log/match-league";
import {
  availableSeedSeasons,
  leanLabel,
  listSeedClubRows,
  predictCornersMatch,
  type CornersConfidence,
  type CornersMatchPrediction,
} from "@/lib/prediction-log/corners-model";
import { usePredictionLogData } from "./use-prediction-log-data";
import { useHshPredictions } from "./use-hsh-predictions";
import { PerTeamLinesPanel } from "./per-team-lines-panel";
import {
  BlendedAnalysisNotice,
  pickBlendFromEstimates,
} from "@/components/analysis/blended-analysis-notice";

const KNOWN_SEASONS = availableSeedSeasons();

function pctProb(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function confidenceStyle(c: CornersConfidence): CSSProperties {
  switch (c) {
    case "high":
      return { background: "rgba(34, 197, 94, 0.2)", color: "#15803d" };
    case "medium":
      return { background: "rgba(245, 158, 11, 0.2)", color: "#b45309" };
    default:
      return { background: "var(--surface2)", color: "var(--muted)" };
  }
}

export function CornersApp() {
  const searchParams = useSearchParams();
  const { ready, error, batches } = usePredictionLogData();

  const [tab, setTab] = useState<"batch" | "clubs">("batch");
  const [league, setLeague] = useState<string>("");
  const [season, setSeason] = useState<string>("all");
  const [batchId, setBatchId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const qLeague = searchParams.get("league");
    const qSeason = searchParams.get("season");
    if (qLeague) {
      const mapped =
        qLeague === "EPL" || qLeague === "PL" ? "Premier League" : qLeague;
      setLeague(mapped);
    }
    if (qSeason) {
      const normalized =
        qSeason === "all" ? "all" : qSeason.includes("/") ? qSeason : qSeason.replace("-", "/");
      setSeason(normalized);
    }
  }, [searchParams]);

  const sortedBatches = useMemo(
    () =>
      [...batches].sort(
        (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
      ),
    [batches]
  );

  useEffect(() => {
    if (!batchId && sortedBatches[0]) setBatchId(sortedBatches[0].id);
  }, [sortedBatches, batchId]);

  const batch = sortedBatches.find((b) => b.id === batchId) ?? null;
  const { predictions: hshPredictions, estimatesById } = useHshPredictions(
    batch,
    batches,
    {}
  );
  const hshByMatch = useMemo(() => {
    const m = new Map(hshPredictions.map((p) => [p.matchId, p]));
    return m;
  }, [hshPredictions]);

  const predictions = useMemo(() => {
    if (!batch) return [] as CornersMatchPrediction[];
    return batch.matches.map((match) => {
      const league = matchLeague(match, batch.league);
      const prediction = predictCornersMatch({
        matchId: match.id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        league,
        batches,
        beforeDate: batch.date,
      });
      const est = estimatesById[match.id];
      // Display O/U 9.5 from canonicalFixtureEstimate (SoT).
      return {
        ...prediction,
        lambdaHome: est?.lambdas.home_corners ?? prediction.lambdaHome,
        lambdaAway: est?.lambdas.away_corners ?? prediction.lambdaAway,
        pOver95: est?.markets.cornersOver95 ?? prediction.pOver95,
        pUnder95: est?.markets.cornersUnder95 ?? prediction.pUnder95,
      };
    });
  }, [batch, batches, estimatesById]);

  const clubRows = useMemo(
    () => listSeedClubRows(league || null, season === "all" ? null : season),
    [league, season]
  );

  const leagueChoices = useMemo(() => {
    const set = new Set<string>([...LEAGUE_OPTIONS]);
    return [...set].sort();
  }, []);

  const blendNotice = useMemo(
    () => pickBlendFromEstimates(estimatesById),
    [estimatesById]
  );

  if (!ready) {
    return <p className="page-sub">Loading…</p>;
  }

  return (
    <div>
      {error && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <BlendedAnalysisNotice blend={blendNotice} pageLabel="Corners" />

      <div style={{ marginBottom: "1.25rem" }}>
        <h1 className="page-title">Corners Analysis</h1>
        <p className="page-sub">
          Both-club corners won × conceded interaction (seed prior + live blend). Advisory only —
          never blocks a pick.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button
          type="button"
          className={`btn ${tab === "batch" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setTab("batch")}
        >
          Batch predictions
        </button>
        <button
          type="button"
          className={`btn ${tab === "clubs" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setTab("clubs")}
        >
          Club seed browser
        </button>
      </div>

      {tab === "batch" ? (
        <>
          <div
            className="card"
            style={{
              marginBottom: "1rem",
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <label style={{ fontSize: "0.8125rem", fontWeight: 600 }}>
              Batch
              <select
                className="select"
                style={{ display: "block", marginTop: "0.25rem", minWidth: "16rem" }}
                value={batchId}
                onChange={(e) => {
                  setBatchId(e.target.value);
                  setExpandedId(null);
                }}
              >
                {sortedBatches.length === 0 && <option value="">No batches</option>}
                {sortedBatches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batchName} ({b.date}) · {b.matches.length} matches
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!batch ? (
            <p className="page-sub">Select a saved batch to price corners O/U.</p>
          ) : predictions.length === 0 ? (
            <p className="page-sub">This batch has no matches.</p>
          ) : (
            <div className="card">
              <table className="table mobile-stack-table" style={{ width: "100%", fontSize: "0.8125rem" }}>
                <thead>
                  <tr>
                    <th>Match</th>
                    <th>λ Home</th>
                    <th>λ Away</th>
                    <th>E[total]</th>
                    <th>P(O9.5)</th>
                    <th>P(O10.5)</th>
                    <th>Lean</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {predictions.map((p) => (
                    <PredictionRow
                      key={p.matchId}
                      prediction={p}
                      hsh={hshByMatch.get(p.matchId) ?? null}
                      expanded={expandedId === p.matchId}
                      onToggle={() =>
                        setExpandedId((id) => (id === p.matchId ? null : p.matchId))
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <div
            className="card"
            style={{
              marginBottom: "1rem",
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <label style={{ fontSize: "0.8125rem", fontWeight: 600 }}>
              League
              <select
                className="select"
                style={{ display: "block", marginTop: "0.25rem", minWidth: "12rem" }}
                value={league}
                onChange={(e) => setLeague(e.target.value)}
              >
                <option value="">All leagues</option>
                {leagueChoices.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: "0.8125rem", fontWeight: 600 }}>
              Season
              <select
                className="select"
                style={{ display: "block", marginTop: "0.25rem", minWidth: "10rem" }}
                value={season}
                onChange={(e) => setSeason(e.target.value)}
              >
                <option value="all">All seasons</option>
                {KNOWN_SEASONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: 0 }}>
              {clubRows.length} seed rows · modeled priors, not scraped match-exact
            </p>
          </div>

          <div className="card table-wrap">
            <table className="table" style={{ width: "100%", fontSize: "0.8125rem" }}>
              <thead>
                <tr>
                  <th>Club</th>
                  <th>League</th>
                  <th>Season</th>
                  <th>Won</th>
                  <th>Conc.</th>
                  <th>Diff</th>
                  <th>% O9.5</th>
                  <th>% O4.5 team</th>
                </tr>
              </thead>
              <tbody>
                {clubRows.map((r) => (
                  <tr key={`${r.league}|${r.season}|${r.clubName}`}>
                    <td>{r.clubName}</td>
                    <td>{r.league}</td>
                    <td>{r.season}</td>
                    <td>{r.avgCornersWon.toFixed(1)}</td>
                    <td>{r.avgCornersConceded.toFixed(1)}</td>
                    <td>{r.cornerDiff.toFixed(1)}</td>
                    <td>{r.pctMatchesOver95Total}%</td>
                    <td>{r.pctMatchesOver45Team}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function PredictionRow({
  prediction: p,
  hsh,
  expanded,
  onToggle,
}: {
  prediction: CornersMatchPrediction;
  hsh: import("@/lib/prediction-log/hsh-model").HshPrediction | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        style={{ cursor: "pointer", minHeight: "2.75rem" }}
        title="Tap for detail"
      >
        <td data-label="Match">
          {p.homeTeam} vs {p.awayTeam}
        </td>
        <td data-label="λ Home">{p.lambdaHome.toFixed(2)}</td>
        <td data-label="λ Away">{p.lambdaAway.toFixed(2)}</td>
        <td data-label="E[total]">{p.expectedTotal.toFixed(2)}</td>
        <td data-label="P(O9.5)">{pctProb(p.pOver95)}</td>
        <td data-label="P(O10.5)">{pctProb(p.pOver105)}</td>
        <td data-label="Lean">
          <strong>
            {p.lean === "lean_none" && p.unavailableReason
              ? p.unavailableReason
              : leanLabel(p.lean)}
          </strong>
        </td>
        <td data-label="Confidence">
          <span className="badge" style={confidenceStyle(p.confidence)}>
            {p.confidence}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} style={{ background: "var(--surface2)", padding: "1rem" }}>
            <DetailPanel prediction={p} hsh={hsh} />
          </td>
        </tr>
      )}
    </>
  );
}

function DetailPanel({
  prediction: p,
  hsh,
}: {
  prediction: CornersMatchPrediction;
  hsh: import("@/lib/prediction-log/hsh-model").HshPrediction | null;
}) {
  const d = p.detail;
  const totalText =
    p.lean === "lean_none"
      ? `No lean · P(O9.5) ${pctProb(p.pOver95)}`
      : `${leanLabel(p.lean)} (${pctProb(p.topProbability)})`;
  return (
    <div style={{ display: "grid", gap: "0.5rem", fontSize: "0.8125rem" }}>
      <strong>
        {p.homeTeam} vs {p.awayTeam}
      </strong>
      <div>
        λ: home {p.lambdaHome.toFixed(2)} · away {p.lambdaAway.toFixed(2)} · total{" "}
        {p.expectedTotal.toFixed(2)} · league base {d.leagueBase.toFixed(2)}
      </div>
      <div>
        Blended rates: {p.homeTeam} won {d.homeWon.toFixed(2)} / conc {d.homeConceded.toFixed(2)} ·{" "}
        {p.awayTeam} won {d.awayWon.toFixed(2)} / conc {d.awayConceded.toFixed(2)}
      </div>
      <div>
        Totals: P(O9.5) {pctProb(p.pOver95)} · P(U9.5) {pctProb(p.pUnder95)} · P(O10.5){" "}
        {pctProb(p.pOver105)} · P(U10.5) {pctProb(p.pUnder105)}
      </div>
      <div>
        Team O4.5 (legacy): {p.homeTeam} {pctProb(p.pHomeOver45)} · {p.awayTeam}{" "}
        {pctProb(p.pAwayOver45)}
      </div>
      {(d.seedHome || d.seedAway) && (
        <div style={{ color: "var(--muted)" }}>
          Sources: {[d.seedHome, d.seedAway].filter(Boolean).join(" · ")}
        </div>
      )}
      <div>
        Lean: <strong>{leanLabel(p.lean)}</strong> ({p.confidence}) — advisory only; match stays in
        batch; nothing is blocked.
      </div>
      {p.confidence === "low" && (
        <p style={{ margin: "0.25rem 0 0", color: "var(--warn)" }}>
          Low confidence — thin or single-season seed. Confirm if you still want this market.
        </p>
      )}
      <PerTeamLinesPanel
        cornersTotal={{ text: totalText, confidence: p.confidence }}
        corners={p}
        hsh={hsh}
        showHtTotal
      />
    </div>
  );
}
