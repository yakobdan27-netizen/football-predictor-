"use client";

import { useState } from "react";
import { BatchMatchTable } from "./batch-match-table";
import { BatchSummaryStrip } from "./batch-summary-strip";
import { LEAGUE_OPTIONS } from "@/lib/prediction-log/markets-config";
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
import type {
  CombinedOddsSettings,
  LogMatch,
  PredictionBatch,
  RecommendationSettings,
} from "@/lib/prediction-log/types";

function emptyMatch(settings: CombinedOddsSettings): LogMatch {
  return {
    id: newId(),
    homeTeam: "",
    awayTeam: "",
    predictions: {},
    actualResults: {},
    scored: {},
    marketMode: settings.defaultMarketMode,
  };
}

function sanitizeTeamsForLeague(match: LogMatch, league: string): LogMatch {
  const teams = new Set(teamsForLeague(league));
  return {
    ...match,
    homeTeam: teams.has(match.homeTeam) ? match.homeTeam : "",
    awayTeam: teams.has(match.awayTeam) ? match.awayTeam : "",
  };
}

function freezeComboProbabilities(
  matches: LogMatch[],
  league: string,
  date: string,
  clubRecords: Record<string, ClubRecord>,
  clubIndex: ClubIndex | null,
  allBatches: PredictionBatch[]
): LogMatch[] {
  return matches.map((m) => {
    if (resolveMarketMode(m) !== "combined" || !m.comboPick?.comboId) return m;
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

import type { TeamsQualityStore } from "@/lib/prediction-log/teams-quality-types";

interface BatchEntryTabProps {
  settings: RecommendationSettings;
  comboSettings: CombinedOddsSettings;
  learnerEnabled: boolean;
  teamsQuality?: TeamsQualityStore | null;
  onSaved: (batchId: string) => void;
}

export function BatchEntryTab({
  settings,
  comboSettings,
  learnerEnabled,
  teamsQuality = null,
  onSaved,
}: BatchEntryTabProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [league, setLeague] = useState<string>(LEAGUE_OPTIONS[0]);
  const [batchName, setBatchName] = useState("");
  const [matches, setMatches] = useState<LogMatch[]>(() => [
    emptyMatch(comboSettings ?? loadCombinedOddsSettings()),
  ]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [noReco, setNoReco] = useState(false);

  function addMatch() {
    setMatches((prev) => [...prev, emptyMatch(comboSettings)]);
  }

  function handleLeagueChange(newLeague: string) {
    setLeague(newLeague);
    setMatches((prev) => prev.map((m) => sanitizeTeamsForLeague(m, newLeague)));
  }

  async function saveBatch() {
    setError(null);
    if (!batchName.trim()) {
      setError("Batch name is required.");
      return;
    }
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i]!;
      if (!isValidFixture(m.homeTeam, m.awayTeam, league)) {
        setError(`Match ${i + 1}: select home and away from the ${league} list (must differ).`);
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

    try {
      await ensureStorageInit();
      const allExisting = loadBatches();
      const clubIndex = await refreshClubIndex();
      const stubBatch: PredictionBatch = {
        id: "freeze-stub",
        date,
        league,
        batchName: batchName.trim(),
        createdAt: new Date().toISOString(),
        batchKind: "manual",
        matches,
      };
      const clubRecords = await loadClubRecordsForBatch(stubBatch, clubIndex, fetchClubRecord);
      const preparedMatches = freezeCorrectScoreOnMatches(
        freezeComboProbabilities(matches, league, date, clubRecords, clubIndex, allExisting),
        league,
        clubRecords,
        clubIndex,
        allExisting
      );

      const batch: PredictionBatch = {
        id: newId(),
        date,
        league,
        batchName: batchName.trim(),
        createdAt: new Date().toISOString(),
        batchKind: "manual",
        matches: preparedMatches,
      };

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
          <div>
            <label className="label">League</label>
            <select
              className="select"
              value={league}
              onChange={(e) => handleLeagueChange(e.target.value)}
            >
              {LEAGUE_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <BatchMatchTable
        mode="entry"
        matches={matches}
        league={league}
        date={date}
        comboSettings={comboSettings}
        teamsQuality={teamsQuality}
        onChange={setMatches}
        onAddMatch={addMatch}
      />

      <BatchSummaryStrip
        mode="entry"
        matches={matches}
        league={league}
        date={date}
        batchName={batchName}
        comboSettings={comboSettings}
      />

      <div className="batch-actions">
        <button type="button" className="btn btn-secondary" onClick={addMatch}>
          + Add match
        </button>
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
