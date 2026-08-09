/**
 * Persist portfolio slip batches (probability fields only).
 */
import { desc, eq } from "drizzle-orm";
// delete via db.delete is provided by drizzle query API
import { getDb, schema } from "@/lib/db";
import type { SlipBatchResult, SlipPreferences } from "./types";

export async function nextBatchNumber(): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: schema.slipBatches.batchNumber })
    .from(schema.slipBatches)
    .orderBy(desc(schema.slipBatches.batchNumber))
    .limit(1);
  return (row?.n ?? 0) + 1;
}

export async function saveSlipBatchResult(
  result: SlipBatchResult,
  opts?: { regeneratedFromId?: number | null }
): Promise<SlipBatchResult> {
  const db = await getDb();
  const batchNumber =
    result.batchNumber > 0 ? result.batchNumber : await nextBatchNumber();
  const createdAt = new Date(result.generatedAt);

  const [inserted] = await db
    .insert(schema.slipBatches)
    .values({
      createdAt,
      preferencesJson: JSON.stringify(result.preferences),
      userNote: result.preferences.userNote || null,
      batchNumber,
      fixtureExclusionIds: JSON.stringify(result.fixtureExclusionIds),
      partialReason: result.partialReason,
      regeneratedFromId: opts?.regeneratedFromId ?? null,
    })
    .returning({ id: schema.slipBatches.id });

  const batchId = inserted!.id;

  for (const slip of result.slips) {
    for (let i = 0; i < slip.legs.length; i++) {
      const leg = slip.legs[i]!;
      await db.insert(schema.slipBatchLegs).values({
        batchId,
        slipIndex: slip.slipIndex,
        legOrder: i,
        fixtureId: leg.fixtureId,
        batchIdSource: leg.sourceBatchId,
        competition: leg.competition,
        kickoffUtc: leg.kickoffIso ? new Date(leg.kickoffIso) : null,
        marketFamily: leg.family,
        selectionLabel: leg.selectionLabel,
        selectionKey: leg.selectionKey,
        line: leg.line,
        comboId: leg.comboId,
        pCalibrated: leg.pCalibrated,
        pRaw: leg.pRaw,
        nEffective: leg.nEffective,
        calibrated: leg.calibrated ? 1 : 0,
        meanRho: slip.meanRho,
        independenceUpper: slip.independenceUpper,
        bandLower: slip.bandLower,
        bandUpper: slip.bandUpper,
        selectionSource: leg.selectionSource,
        machineRank: leg.machineRank,
        correlationContribution: leg.correlationContribution,
        homeTeam: leg.homeTeam,
        awayTeam: leg.awayTeam,
        outcome: null,
      });
    }
  }

  return {
    ...result,
    batchId: String(batchId),
    batchNumber,
  };
}

export async function loadSlipBatch(
  id: number
): Promise<SlipBatchResult | null> {
  const db = await getDb();
  const [batch] = await db
    .select()
    .from(schema.slipBatches)
    .where(eq(schema.slipBatches.id, id))
    .limit(1);
  if (!batch) return null;

  const legs = await db
    .select()
    .from(schema.slipBatchLegs)
    .where(eq(schema.slipBatchLegs.batchId, id));

  const prefs = JSON.parse(batch.preferencesJson) as SlipPreferences;
  const bySlip = new Map<number, typeof legs>();
  for (const leg of legs) {
    const list = bySlip.get(leg.slipIndex) ?? [];
    list.push(leg);
    bySlip.set(leg.slipIndex, list);
  }

  const slips = [...bySlip.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slipIndex, slipLegs]) => {
      const ordered = [...slipLegs].sort((a, b) => a.legOrder - b.legOrder);
      const first = ordered[0];
      return {
        slipIndex,
        family: (first?.marketFamily ?? "RESULT_1X2") as SlipBatchResult["slips"][0]["family"],
        legs: ordered.map((leg) => ({
          fixtureId: leg.fixtureId,
          apiFixtureId: null,
          matchId: leg.fixtureId,
          sourceBatchId: leg.batchIdSource ?? "",
          homeTeam: leg.homeTeam ?? "",
          awayTeam: leg.awayTeam ?? "",
          competition: leg.competition,
          kickoffIso: leg.kickoffUtc?.toISOString() ?? "",
          kickoffMs: leg.kickoffUtc?.getTime() ?? 0,
          family: leg.marketFamily as SlipBatchResult["slips"][0]["family"],
          selectionKey: leg.selectionKey,
          selectionLabel: leg.selectionLabel,
          line: leg.line,
          comboId: leg.comboId,
          pRaw: leg.pRaw,
          pCalibrated: leg.pCalibrated,
          nEffective: leg.nEffective,
          ciWidth: 0,
          calibrated: leg.calibrated === 1,
          coherenceOk: true,
          selectionSource: leg.selectionSource as "machine" | "manual_add" | "swap",
          machineRank: leg.machineRank,
          correlationContribution: leg.correlationContribution ?? 0,
        })),
        independenceUpper: first?.independenceUpper ?? 0,
        bandLower: first?.bandLower ?? 0,
        bandUpper: first?.bandUpper ?? 0,
        meanRho: first?.meanRho ?? 0,
        provisional: ordered.some((l) => l.calibrated !== 1),
        manuallyAltered: ordered.some(
          (l) =>
            l.selectionSource === "manual_add" || l.selectionSource === "swap"
        ),
      };
    });

  return {
    batchId: String(batch.id),
    batchNumber: batch.batchNumber,
    generatedAt: batch.createdAt.toISOString(),
    preferences: prefs,
    slips,
    filtered: [],
    partialReason: batch.partialReason,
    fixtureExclusionIds: batch.fixtureExclusionIds
      ? (JSON.parse(batch.fixtureExclusionIds) as string[])
      : [],
  };
}

export async function listSlipBatches(limit = 20): Promise<
  Array<{
    id: number;
    batchNumber: number;
    createdAt: string;
    partialReason: string | null;
    userNote: string | null;
    slipCount: number;
  }>
> {
  const db = await getDb();
  const batches = await db
    .select()
    .from(schema.slipBatches)
    .orderBy(desc(schema.slipBatches.createdAt))
    .limit(limit);

  const out = [];
  for (const b of batches) {
    const legs = await db
      .select({ slipIndex: schema.slipBatchLegs.slipIndex })
      .from(schema.slipBatchLegs)
      .where(eq(schema.slipBatchLegs.batchId, b.id));
    const slipCount = new Set(legs.map((l) => l.slipIndex)).size;
    out.push({
      id: b.id,
      batchNumber: b.batchNumber,
      createdAt: b.createdAt.toISOString(),
      partialReason: b.partialReason,
      userNote: b.userNote,
      slipCount,
    });
  }
  return out;
}

export async function updateSlipBatchResult(
  id: number,
  result: SlipBatchResult
): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.slipBatches)
    .set({
      preferencesJson: JSON.stringify(result.preferences),
      userNote: result.preferences.userNote || null,
      partialReason: result.partialReason,
      fixtureExclusionIds: JSON.stringify(result.fixtureExclusionIds),
    })
    .where(eq(schema.slipBatches.id, id));

  // Replace legs
  await db
    .delete(schema.slipBatchLegs)
    .where(eq(schema.slipBatchLegs.batchId, id));

  for (const slip of result.slips) {
    for (let i = 0; i < slip.legs.length; i++) {
      const leg = slip.legs[i]!;
      await db.insert(schema.slipBatchLegs).values({
        batchId: id,
        slipIndex: slip.slipIndex,
        legOrder: i,
        fixtureId: leg.fixtureId,
        batchIdSource: leg.sourceBatchId,
        competition: leg.competition,
        kickoffUtc: leg.kickoffIso ? new Date(leg.kickoffIso) : null,
        marketFamily: leg.family,
        selectionLabel: leg.selectionLabel,
        selectionKey: leg.selectionKey,
        line: leg.line,
        comboId: leg.comboId,
        pCalibrated: leg.pCalibrated,
        pRaw: leg.pRaw,
        nEffective: leg.nEffective,
        calibrated: leg.calibrated ? 1 : 0,
        meanRho: slip.meanRho,
        independenceUpper: slip.independenceUpper,
        bandLower: slip.bandLower,
        bandUpper: slip.bandUpper,
        selectionSource: leg.selectionSource,
        machineRank: leg.machineRank,
        correlationContribution: leg.correlationContribution,
        homeTeam: leg.homeTeam,
        awayTeam: leg.awayTeam,
        outcome: null,
      });
    }
  }
}
