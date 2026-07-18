"use client";

import { useState } from "react";
import { BatchMatchTable } from "./batch-match-table";
import { BatchSummaryStrip } from "./batch-summary-strip";
import { LEAGUE_OPTIONS } from "@/lib/prediction-log/markets-config";
import {
  deriveBatchLeague,
  matchLeague,
  normalizeMatchLeagues,
} from "@/lib/prediction-log/match-league";
import {
  hydrateComboFromEntry,
  resolveMarketMode,
  validateMatchLeg,
} from "@/lib/prediction-log/match-entry-helpers";
import { loadCombinedOddsSettings } from "@/lib/prediction-log/combo-settings";
import {
  upsertBatch,
  newId,
  saveAnalysis,
  loadBatches,
  generateBatchRecommendationAsync,
  updateLearnerStats,
  updateTeamCharacteristics,
  updateLeagueProfiles,
  ensureStorageInit,
  refreshClubIndex,
  fetchClubRecord,
} from "@/lib/prediction-log/storage";
import { loadClubRecordsForBatch } from "@/lib/prediction-log/club-record-insights";
import type { ClubIndex, ClubRecord } from "@/lib/prediction-log/club-record-types";
import { recomputeAnalysis } from "@/lib/prediction-log/analysis";
import { isValidFixture, teamsForLeague } from "@/lib/prediction-log/teams";
import { isValidOdds } from "@/lib/prediction-log/odds-bands";
import { computeEntryLegProbability, entryValueFromGrid } from "@/lib/prediction-log/combo-entry-probability";
import {
  freezeCorrectScoreOnMatches,
} from "@/lib/prediction-log/correct-score-freeze";
import {
  findCrossBatchDuplicates,
  type DuplicateHit,
} from "@/lib/prediction-log/cross-batch-duplicate-check";
import type {
  CombinedOddsSettings,
  LogMatch,
  MatchLineups,
  PredictionBatch,
  RecommendationSettings,
} from "@/lib/prediction-log/types";
import type { TeamsQualityStore } from "@/lib/prediction-log/teams-quality-types";
import {
  aggregateBatchPlacementAlerts,
  evaluateStopLoss,
} from "@/lib/prediction-log/strategy-rules";
import { DuplicateBlockModal } from "./duplicate-block-modal";

function emptyMatch(settings: CombinedOddsSettings, league: string): LogMatch {
  return {
    id: newId(),
    homeTeam: "",
    awayTeam: "",
    league,
    predictions: {},
    actualResults: {},
    scored: {},
    marketMode: settings.defaultMarketMode,
  };
}

function freezeComboProbabilities(
  matches: LogMatch[],
  batchLeague: string,
  date: string,
  clubRecords: Record<string, ClubRecord>,
  clubIndex: ClubIndex | null,
  allBatches: PredictionBatch[]
): LogMatch[] {
  return matches.map((m) => {
    if (resolveMarketMode(m) !== "combined" || !m.comboPick?.comboId) return m;
    const league = matchLeague(m, batchLeague);
    const prob = computeEntryLegProbability(m, league, clubRecords, clubIndex, allBatches);
    return {
      ...m,
      comboPick: {
        ...m.comboPick,
        systemProbability: prob.pGrid ?? m.comboPick.systemProbability,
        valueEdge:
          entryValueFromGrid(prob.pGrid, m.comboPick.odds) ?? m.comboPick.valueEdge,
      },
    };
  });
}

interface BatchEntryTabProps {
  settings: RecommendationSettings;
  comboSettings: CombinedOddsSettings;
  learnerEnabled: boolean;
  teamsQuality?: TeamsQualityStore | null;
  onSaved: (batchId: string) => void;
  onViewBatch?: (batchId: string) => void;
}

export function BatchEntryTab({
  settings,
  comboSettings,
  learnerEnabled,
  teamsQuality = null,
  onSaved,
  onViewBatch,
}: BatchEntryTabProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [defaultLeague, setDefaultLeague] = useState<string>(LEAGUE_OPTIONS[0]);
  const [fixtureLeague, setFixtureLeague] = useState<string>(LEAGUE_OPTIONS[0]);
  const [batchName, setBatchName] = useState("");
  const [matches, setMatches] = useState<LogMatch[]>(() => [
    emptyMatch(comboSettings ?? loadCombinedOddsSettings(), LEAGUE_OPTIONS[0]),
  ]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [noReco, setNoReco] = useState(false);
  const [loadingFixtures, setLoadingFixtures] = useState(false);
  const [fixtureMsg, setFixtureMsg] = useState<string | null>(null);
  const [duplicateHits, setDuplicateHits] = useState<DuplicateHit[] | null>(null);

  function addMatch() {
    setMatches((prev) => [...prev, emptyMatch(comboSettings, defaultLeague)]);
  }

  async function loadFixturesFromLivescore() {
    setError(null);
    setFixtureMsg(null);
    setLoadingFixtures(true);
    try {
      const res = await fetch("/api/livescore-fixtures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, league: fixtureLeague, competition: fixtureLeague }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        fixtures?: Array<{
          eventId: string;
          homeTeam: string;
          awayTeam: string;
          lineups?: MatchLineups;
        }>;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load fixtures");

      const fixtures = data.fixtures ?? [];
      const leagueTeams = new Set(teamsForLeague(fixtureLeague));
      const usable = fixtures.filter(
        (f) => leagueTeams.has(f.homeTeam) && leagueTeams.has(f.awayTeam) && f.homeTeam !== f.awayTeam
      );

      if (!usable.length) {
        setFixtureMsg(
          fixtures.length
            ? `Found ${fixtures.length} Livescore fixture(s) but none matched ${fixtureLeague} team names. Enter teams manually.`
            : "No Livescore fixtures found for this date. Enter teams manually."
        );
        return;
      }

      const settings = comboSettings;
      const imported: LogMatch[] = usable.map((f) => ({
        ...emptyMatch(settings, fixtureLeague),
        homeTeam: f.homeTeam,
        awayTeam: f.awayTeam,
        league: fixtureLeague,
        livescoreEventId: f.eventId,
        ...(f.lineups
          ? { teamStats: { home: {}, away: {}, lineups: f.lineups } }
          : {}),
      }));

      setMatches((prev) => {
        const kept = prev.filter((m) => m.homeTeam.trim() || m.awayTeam.trim());
        return [...kept, ...imported];
      });
      setFixtureMsg(
        `Loaded ${imported.length} fixture(s) from Livescore` +
          (usable.some((f) => f.lineups) ? " (lineups attached when published)." : ".")
      );
    } catch (e) {
      setFixtureMsg(
        e instanceof Error
          ? `${e.message} — enter teams manually.`
          : "Fixture load failed — enter teams manually."
      );
    } finally {
      setLoadingFixtures(false);
    }
  }

  async function saveBatch() {
    setError(null);
    if (!batchName.trim()) {
      setError("Batch name is required.");
      return;
    }
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i]!;
      const rowLeague = matchLeague(m, defaultLeague);
      if (!isValidFixture(m.homeTeam, m.awayTeam, rowLeague, teamsQuality)) {
        setError(`Match ${i + 1}: select home and away from the ${rowLeague} list (must differ).`);
        return;
      }
      const legErr = validateMatchLeg(m);
      if (legErr) {
        setError(`Match ${i + 1}: ${legErr}`);
        return;
      }
      if (resolveMarketMode(m) === "combined") {
        if (!isValidOdds(m.comboPick?.odds)) {
          setError(`Match ${i + 1}: enter valid combined odds (1.00–3.00).`);
          return;
        }
      } else {
        const preds = Object.values(m.predictions);
        if (preds.length !== 1 || !isValidOdds(preds[0]?.odds)) {
          setError(`Match ${i + 1}: enter valid odds (1.00–3.00) for your market.`);
          return;
        }
      }
    }

    const bs = settings.bankrollStrategy;
    const stop = evaluateStopLoss(loadBatches(), bs);
    const alerts = aggregateBatchPlacementAlerts(matches, bs, stop);
    if (alerts.messages.length > 0) {
      const riskBits: string[] = [];
      if (alerts.flags.includes("over_risk_cap") || alerts.flags.includes("over_absolute_cap")) {
        riskBits.push(
          "Stakes above max risk increase risk of ruin — keep ≤2% of bankroll when possible."
        );
      }
      if (alerts.flags.includes("stop_loss_active") || stop.stopLossActive) {
        riskBits.push(
          "Stop-loss / drawdown rules suggest pausing new bets until bankroll recovers."
        );
        riskBits.push(
          "No chasing losses: after a drawdown, only continue if you explicitly confirm."
        );
      }
      const ok = window.confirm(
        `Strategy alerts (advisory — save still allowed, nothing is blocked):\n\n• ${alerts.messages.join("\n• ")}${
          riskBits.length ? `\n\nRisk-of-ruin:\n• ${riskBits.join("\n• ")}` : ""
        }\n\nSave batch anyway?`
      );
      if (!ok) return;
    }

    try {
      await ensureStorageInit();
      const allExisting = loadBatches();
      const clubIndex = await refreshClubIndex();
      const normalizedMatches = normalizeMatchLeagues(matches, defaultLeague);
      const batchLeague = deriveBatchLeague(normalizedMatches, defaultLeague);
      const stubBatch: PredictionBatch = {
        id: "freeze-stub",
        date,
        league: batchLeague,
        batchName: batchName.trim(),
        createdAt: new Date().toISOString(),
        batchKind: "manual",
        matches: normalizedMatches,
      };
      const clubRecords = await loadClubRecordsForBatch(stubBatch, clubIndex, fetchClubRecord);
      const preparedMatches = freezeCorrectScoreOnMatches(
        freezeComboProbabilities(
          normalizedMatches,
          batchLeague,
          date,
          clubRecords,
          clubIndex,
          allExisting
        ),
        batchLeague,
        clubRecords,
        clubIndex,
        allExisting
      );

      const batch: PredictionBatch = {
        id: newId(),
        date,
        league: batchLeague,
        batchName: batchName.trim(),
        createdAt: new Date().toISOString(),
        batchKind: "manual",
        matches: preparedMatches,
      };

      const duplicates = findCrossBatchDuplicates({
        incomingBatch: batch,
        allBatches: allExisting,
      });
      if (duplicates.length > 0) {
        setDuplicateHits(duplicates);
        return;
      }

      await upsertBatch(batch);
      const all = loadBatches();
      const savedBatch = all.find((b) => b.id === batch.id) ?? batch;
      const updatedAnalysis = recomputeAnalysis(all);
      updateLearnerStats();
      updateTeamCharacteristics();
      updateLeagueProfiles();
      let withReco = await generateBatchRecommendationAsync(savedBatch, settings, learnerEnabled);
      withReco = hydrateComboFromEntry(withReco);
      await upsertBatch(withReco);
      saveAnalysis(updatedAnalysis);
      setNoReco(!withReco.recommended);
      setSaved(true);
      onSaved(withReco.id);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save batch");
    }
  }

  return (
    <div>
      {duplicateHits ? (
        <DuplicateBlockModal
          duplicates={duplicateHits}
          onCancel={() => setDuplicateHits(null)}
          onViewBatch={(batchId) => {
            setDuplicateHits(null);
            onViewBatch?.(batchId);
          }}
        />
      ) : null}
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <div>
            <label className="label">Batch name</label>
            <input
              className="input"
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              placeholder="PL Matchday 34"
            />
          </div>
          <div>
            <label className="label">Date</label>
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: 0 }}>
            Use the League column on each match row to mix competitions (e.g. Premier League + La Liga). The
            dropdown above only sets the default for new rows and Livescore import.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
            <select
              className="select"
              value={fixtureLeague}
              onChange={(e) => {
                const next = e.target.value;
                setFixtureLeague(next);
                setDefaultLeague(next);
              }}
              style={{ maxWidth: "220px" }}
              aria-label="League for fixture import"
            >
              {LEAGUE_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loadingFixtures || !date}
              onClick={() => void loadFixturesFromLivescore()}
            >
              {loadingFixtures ? "Loading fixtures…" : "Load fixtures from Livescore"}
            </button>
            <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              Import fixtures for the selected league and date (manual entry always works).
            </span>
          </div>
          {fixtureMsg && (
            <p style={{ fontSize: "0.8125rem", color: "var(--accent)", margin: 0 }}>{fixtureMsg}</p>
          )}
        </div>
      </div>

      <BatchMatchTable
        mode="entry"
        matches={matches}
        defaultLeague={defaultLeague}
        date={date}
        comboSettings={comboSettings}
        bankrollStrategy={settings.bankrollStrategy}
        teamsQuality={teamsQuality}
        onChange={setMatches}
        onAddMatch={addMatch}
        createEmptyMatch={() => emptyMatch(comboSettings, defaultLeague)}
      />

      <BatchSummaryStrip
        mode="entry"
        matches={matches}
        defaultLeague={defaultLeague}
        date={date}
        batchName={batchName}
        comboSettings={comboSettings}
        bankrollStrategy={settings.bankrollStrategy}
      />

      <div className="batch-actions">
        <button type="button" className="btn btn-primary" onClick={saveBatch}>
          Save batch
        </button>
      </div>

      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {saved && !noReco && (
        <p style={{ color: "var(--accent)" }}>
          Batch saved — {learnerEnabled ? "AI Learner" : "recommended"} version generated. View in
          Saved Batches.
        </p>
      )}
      {saved && noReco && (
        <p style={{ color: "var(--warn)" }}>
          Current batch has too many high-risk picks. No safe recommendation generated.
        </p>
      )}
    </div>
  );
}
