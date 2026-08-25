"use client";

import { useState } from "react";
import { BatchMatchTable } from "./batch-match-table";
import { BatchSummaryStrip } from "./batch-summary-strip";
import { FixtureBatchPicker } from "./fixture-batch-picker";
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
import { deriveBatchDateFromMatches } from "@/lib/prediction-log/batch-date";
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
import { isValidFixture } from "@/lib/prediction-log/teams";
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
  PredictionBatch,
  RecommendationSettings,
} from "@/lib/prediction-log/types";
import type { TeamsQualityStore } from "@/lib/prediction-log/teams-quality-types";
import {
  aggregateBatchPlacementAlerts,
  evaluateStopLoss,
} from "@/lib/prediction-log/strategy-rules";
import { DuplicateBlockModal } from "./duplicate-block-modal";
import { todayIsoDate } from "@/lib/prediction-log/batch-date";
import { stampPendingTrace } from "@/lib/prediction-log/result-trace";

function emptyMatch(settings: CombinedOddsSettings, league: string): LogMatch {
  return stampPendingTrace({
    id: newId(),
    homeTeam: "",
    awayTeam: "",
    league,
    predictions: {},
    actualResults: {},
    scored: {},
    marketMode: settings.defaultMarketMode,
  });
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

type EntryMode = "fixtures" | "manual";

export function BatchEntryTab({
  settings,
  comboSettings,
  learnerEnabled,
  teamsQuality = null,
  onSaved,
  onViewBatch,
}: BatchEntryTabProps) {
  const [entryMode, setEntryMode] = useState<EntryMode>("fixtures");
  const [defaultLeague, setDefaultLeague] = useState<string>(LEAGUE_OPTIONS[0]);
  const [batchName, setBatchName] = useState("");
  const [matches, setMatches] = useState<LogMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [noReco, setNoReco] = useState(false);
  const [duplicateHits, setDuplicateHits] = useState<DuplicateHit[] | null>(null);
  /** Creation stamp only — result filling traces by home/away names, not this date. */
  const stubDate = todayIsoDate();

  function switchEntryMode(mode: EntryMode) {
    setEntryMode(mode);
    setError(null);
    if (mode === "fixtures") {
      setMatches((prev) => prev.filter((m) => m.apiFixtureId != null && m.homeTeam.trim()));
    } else if (matches.length === 0 || matches.every((m) => !m.homeTeam.trim() && !m.awayTeam.trim())) {
      setMatches([emptyMatch(comboSettings, defaultLeague)]);
    }
  }

  function addMatch() {
    setMatches((prev) => [...prev, emptyMatch(comboSettings, defaultLeague)]);
  }

  async function saveBatch() {
    setError(null);
    if (!batchName.trim()) {
      setError("Batch name is required.");
      return;
    }
    if (matches.length === 0) {
      setError(entryMode === "fixtures" ? "Add at least one match from the fixture list." : "Add at least one match.");
      return;
    }
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i]!;
      const rowLeague = matchLeague(m, defaultLeague);
      if (entryMode === "fixtures") {
        if (!m.homeTeam.trim() || !m.awayTeam.trim() || m.apiFixtureId == null) {
          setError(`Match ${i + 1}: pick a fixture from the list.`);
          return;
        }
      } else if (!isValidFixture(m.homeTeam, m.awayTeam, rowLeague, teamsQuality)) {
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
      const batchDate =
        deriveBatchDateFromMatches(
          normalizedMatches.map((m) => ({ matchDate: m.matchDate }))
        ) || stubDate;
      const stubBatch: PredictionBatch = {
        id: "freeze-stub",
        date: batchDate,
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
          batchDate,
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
        date: batchDate,
        league: batchLeague,
        batchName: batchName.trim(),
        createdAt: new Date().toISOString(),
        batchKind: "manual",
        matches: preparedMatches.map((m) => stampPendingTrace(m)),
      };

      const duplicates = findCrossBatchDuplicates({
        incomingBatch: batch,
        allBatches: allExisting,
      });
      if (duplicates.length > 0) {
        setDuplicateHits(duplicates);
        return;
      }

      // Names-only save — API fixture id / date filled later by ordered name-pair trace.
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
          <div
            className="batch-seg"
            style={{ display: "inline-flex", marginBottom: "0.5rem" }}
          >
            <button
              type="button"
              className={entryMode === "fixtures" ? "active" : ""}
              onClick={() => switchEntryMode("fixtures")}
            >
              Pick from fixtures
            </button>
            <button
              type="button"
              className={entryMode === "manual" ? "active" : ""}
              onClick={() => switchEntryMode("manual")}
            >
              Manual entry
            </button>
          </div>
          {entryMode === "manual" ? (
            <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: 0 }}>
              Enter home and away team names and your markets. No date or fixture id is required —
              results fill automatically when the API finds a finished match with the same ordered
              home–away pairing.
            </p>
          ) : null}
        </div>
      </div>

      {entryMode === "fixtures" ? (
        <FixtureBatchPicker
          matches={matches}
          comboSettings={comboSettings}
          onChange={setMatches}
        />
      ) : (
        <BatchMatchTable
          mode="entry"
          matches={matches}
          defaultLeague={defaultLeague}
          date={stubDate}
          comboSettings={comboSettings}
          bankrollStrategy={settings.bankrollStrategy}
          teamsQuality={teamsQuality}
          onChange={setMatches}
          onAddMatch={addMatch}
          createEmptyMatch={() => emptyMatch(comboSettings, defaultLeague)}
        />
      )}

      {matches.length > 0 ? (
        <BatchSummaryStrip
          mode="entry"
          matches={matches}
          defaultLeague={defaultLeague}
          date={stubDate}
          batchName={batchName}
          comboSettings={comboSettings}
          bankrollStrategy={settings.bankrollStrategy}
        />
      ) : null}

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
