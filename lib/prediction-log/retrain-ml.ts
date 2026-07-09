import { computeLeagueBaselines } from "./league-baselines";
import { saveLeagueBaselinesToKv } from "./ml-model-store";
import { buildTrainingRows } from "./training-data";
import { trainClassifier } from "./ml-engine";
import { saveMlClassifier } from "./ml-model-store";
import type { AnalysisHistory, PredictionBatch } from "./types";
import type { ClubRecord } from "./club-record-types";
import type { TeamsQualityStore } from "./teams-quality-types";
import { STAT_ENGINE_CONFIG } from "./stat-engine-config";
import { loadAllBatches } from "./club-store";
import { loadTeamsQualityStore } from "./teams-quality-store";
import { recomputeAnalysis } from "./analysis";
import { loadClubRecordsByIds } from "./club-history-writer";

function batchHasScored1x2(batch: PredictionBatch): boolean {
  return batch.matches.some((m) => {
    const actual = m.actualResults?.["1x2"]?.actual;
    return (
      typeof actual === "string" &&
      ["home", "draw", "away"].includes(actual.toLowerCase())
    );
  });
}

function collectClubIdsFromBatches(batches: PredictionBatch[]): string[] {
  const ids = new Set<string>();
  for (const b of batches) {
    for (const m of b.matches) {
      if (m.homeClubId) ids.add(m.homeClubId);
      if (m.awayClubId) ids.add(m.awayClubId);
    }
  }
  return [...ids];
}

export async function retrainStatModels(
  batches: PredictionBatch[],
  clubRecords: Record<string, ClubRecord>,
  analysis: AnalysisHistory | null,
  teamsQuality: TeamsQualityStore | null
) {
  const leagueBaselines = computeLeagueBaselines(batches);
  await saveLeagueBaselinesToKv(leagueBaselines);

  const rows = buildTrainingRows(
    batches,
    clubRecords,
    analysis,
    teamsQuality,
    leagueBaselines
  );
  const classifier = trainClassifier(rows);
  await saveMlClassifier(classifier);

  return { leagueBaselines, classifier, trainingRows: rows.length };
}

/** Retrain Dixon-Coles baselines + ML classifier after a batch gains scored 1x2 results. */
export async function maybeRetrainOnBatchResult(batch: PredictionBatch) {
  if (!STAT_ENGINE_CONFIG.RETRAIN_ON_RESULT) return null;
  if (!batchHasScored1x2(batch)) return null;

  const allBatches = await loadAllBatches();
  const ids = collectClubIdsFromBatches(allBatches);
  const map = await loadClubRecordsByIds(ids);
  const clubRecords = Object.fromEntries(map) as Record<string, ClubRecord>;
  const analysis = recomputeAnalysis(allBatches);
  const teamsQuality = await loadTeamsQualityStore();
  return retrainStatModels(allBatches, clubRecords, analysis, teamsQuality);
}
