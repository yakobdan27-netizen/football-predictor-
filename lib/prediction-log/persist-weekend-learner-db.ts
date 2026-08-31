/**
 * Persist graded Weekend Picks outcomes to Postgres for AI Learner rules.
 */
import { getDb } from "@/lib/db";
import {
  aiLearnerPickOutcomes,
  type NewAiLearnerPickOutcome,
} from "@/lib/db/schema";
import { gradeMatchFromFacts } from "./grade-from-facts";
import { matchLeague } from "./match-league";
import { resolveMarketMode, singleMarketKey } from "./match-entry-helpers";
import { persistRichSettlementBatch } from "./persist-rich-settlement";
import type { LogMatch, PredictionBatch, ScoreResult } from "./types";
import {
  isWeekendBaseBatchId,
  isWeekendBatchId,
  WEEKEND_ANALYSIS_SURFACES,
} from "./weekend-analysis-learner";

export type WeekendPickOutcomeExtract = Omit<
  NewAiLearnerPickOutcome,
  "id" | "filledAt" | "updatedAt"
>;

export function weekendSurfaceFromBatchId(batchId: string): string {
  if (batchId.startsWith("WEEKEND-PORTFOLIO-")) return "PORTFOLIO";
  if (isWeekendBaseBatchId(batchId)) return "POOL";
  for (const surface of WEEKEND_ANALYSIS_SURFACES) {
    if (batchId.startsWith(`WEEKEND-${surface.suffix}-`)) return surface.suffix;
  }
  return "WEEKEND";
}

function hasFtGoals(match: LogMatch): boolean {
  const hg = match.teamStats?.home?.goals;
  const ag = match.teamStats?.away?.goals;
  return hg != null && ag != null && Number.isFinite(hg) && Number.isFinite(ag);
}

function primaryResult(match: LogMatch): {
  marketKey: string;
  prediction: string;
  line: number | null;
  confidence: number | null;
  result: ScoreResult;
  actualValue: string | null;
  lossReason: string | null;
} | null {
  const mode = resolveMarketMode(match);
  if (mode === "combined" && match.comboPick?.comboId) {
    const result = match.primaryGrade?.result ?? null;
    if (result == null || result === "void") return null;
    return {
      marketKey: "combo",
      prediction: match.comboPick.comboId,
      line: null,
      confidence: match.comboPick.systemProbability
        ? Math.round(match.comboPick.systemProbability * 100)
        : null,
      result,
      actualValue: null,
      lossReason: result === "wrong" ? match.primaryGrade?.reason ?? null : null,
    };
  }

  const key = singleMarketKey(match);
  if (!key || !match.predictions[key]) return null;
  const pred = match.predictions[key]!;
  const result = match.scored[key] ?? match.primaryGrade?.result ?? null;
  if (result == null || result === "void") return null;
  const actual = match.actualResults[key]?.actual;
  return {
    marketKey: key,
    prediction: pred.prediction,
    line: pred.line ?? null,
    confidence: pred.confidence ?? null,
    result,
    actualValue: actual != null ? String(actual) : null,
    lossReason:
      result === "wrong"
        ? match.primaryGrade?.reason ?? match.silentGrades?.[key]?.reason ?? null
        : null,
  };
}

/** Build a Postgres row from a graded weekend batch match (pure — testable). */
export function extractWeekendPickOutcome(
  batch: PredictionBatch,
  match: LogMatch
): WeekendPickOutcomeExtract | null {
  if (!isWeekendBatchId(batch.id)) return null;
  if (isWeekendBaseBatchId(batch.id)) return null;
  if (!hasFtGoals(match)) return null;

  const graded = gradeMatchFromFacts(match);
  const primary = primaryResult(graded);
  if (!primary) return null;

  const ts = graded.teamStats!;
  return {
    batchId: batch.id,
    matchId: match.id,
    providerFixtureId: match.apiFixtureId ?? null,
    weekendSurface: weekendSurfaceFromBatchId(batch.id),
    league: matchLeague(match, batch.league),
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    matchDate: match.matchDate ?? batch.date,
    marketKey: primary.marketKey,
    prediction: primary.prediction,
    line: primary.line,
    confidence: primary.confidence,
    result: primary.result as "correct" | "wrong" | "push" | "void",
    actualValue: primary.actualValue,
    lossReason: primary.lossReason,
    ftHome: ts.home!.goals!,
    ftAway: ts.away!.goals!,
    htHome: ts.home?.firstHalfGoals ?? null,
    htAway: ts.away?.firstHalfGoals ?? null,
    cornersHome: ts.home?.corners ?? null,
    cornersAway: ts.away?.corners ?? null,
  };
}

async function upsertOutcome(row: WeekendPickOutcomeExtract): Promise<void> {
  const db = await getDb();
  const now = new Date();
  await db
    .insert(aiLearnerPickOutcomes)
    .values({
      ...row,
      filledAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        aiLearnerPickOutcomes.batchId,
        aiLearnerPickOutcomes.matchId,
        aiLearnerPickOutcomes.marketKey,
      ],
      set: {
        providerFixtureId: row.providerFixtureId,
        weekendSurface: row.weekendSurface,
        league: row.league,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        matchDate: row.matchDate,
        prediction: row.prediction,
        line: row.line,
        confidence: row.confidence,
        result: row.result,
        actualValue: row.actualValue,
        lossReason: row.lossReason,
        ftHome: row.ftHome,
        ftAway: row.ftAway,
        htHome: row.htHome,
        htAway: row.htAway,
        cornersHome: row.cornersHome,
        cornersAway: row.cornersAway,
        updatedAt: now,
      },
    });
}

export type PersistWeekendLearnerSummary = {
  outcomesUpserted: number;
  settlementPersisted: number;
  batchesProcessed: number;
  errors: string[];
};

/** Upsert weekend pick outcomes + rich settlement for one batch. */
export async function persistWeekendLearnerBatch(
  batch: PredictionBatch
): Promise<PersistWeekendLearnerSummary> {
  const summary: PersistWeekendLearnerSummary = {
    outcomesUpserted: 0,
    settlementPersisted: 0,
    batchesProcessed: 0,
    errors: [],
  };
  if (!isWeekendBatchId(batch.id)) return summary;

  summary.batchesProcessed = 1;
  for (const match of batch.matches) {
    try {
      const row = extractWeekendPickOutcome(batch, match);
      if (!row) continue;
      await upsertOutcome(row);
      summary.outcomesUpserted += 1;
    } catch (e) {
      summary.errors.push(
        `${match.homeTeam} vs ${match.awayTeam}: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
  }

  try {
    const settled = await persistRichSettlementBatch(batch);
    summary.settlementPersisted = settled.persisted;
  } catch (e) {
    summary.errors.push(
      `rich settlement: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  return summary;
}

/** Persist all weekend batches from a batch list. */
export async function persistWeekendLearnerFromBatches(
  batches: PredictionBatch[]
): Promise<PersistWeekendLearnerSummary> {
  const total: PersistWeekendLearnerSummary = {
    outcomesUpserted: 0,
    settlementPersisted: 0,
    batchesProcessed: 0,
    errors: [],
  };
  for (const batch of batches) {
    if (!isWeekendBatchId(batch.id)) continue;
    const part = await persistWeekendLearnerBatch(batch);
    total.outcomesUpserted += part.outcomesUpserted;
    total.settlementPersisted += part.settlementPersisted;
    total.batchesProcessed += part.batchesProcessed;
    total.errors.push(...part.errors);
  }
  return total;
}

/** Count outcomes in Postgres (for UI). */
export async function countAiLearnerPickOutcomes(): Promise<number> {
  const db = await getDb();
  const rows = await db.select({ id: aiLearnerPickOutcomes.id }).from(aiLearnerPickOutcomes);
  return rows.length;
}
