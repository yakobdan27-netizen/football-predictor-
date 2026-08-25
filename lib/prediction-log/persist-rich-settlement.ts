/**
 * Persist rich Saved Batch settlement to Postgres (idempotent upsert).
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  coreFixture,
  coreFixtureStatistic,
  coreResultTrace,
  predictionLogSettlement,
} from "@/lib/db/schema";
import { matchLeague } from "./match-league";
import {
  batchAllMatchesRichSettlement,
  matchHalfTotals,
  matchHasRichSettlement,
} from "./match-settlement";
import type { LogMatch, PredictionBatch } from "./types";
import type { NewPredictionLogSettlement } from "@/lib/db/schema";

export function settlementRowFromMatch(
  batch: PredictionBatch,
  match: LogMatch,
  opts?: {
    coreFixtureId?: number | null;
    providerFixtureId?: number | null;
    now?: Date;
  }
): NewPredictionLogSettlement | null {
  if (!matchHasRichSettlement(match)) return null;
  const ts = match.teamStats!;
  const halves = matchHalfTotals(match);
  if (halves.htTotal == null || halves.h2Total == null) return null;

  const now = opts?.now ?? new Date();
  return {
    batchId: batch.id,
    matchId: match.id,
    league: matchLeague(match, batch.league),
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    matchDate: match.matchDate ?? batch.date,
    ftHome: ts.home!.goals!,
    ftAway: ts.away!.goals!,
    htHome: ts.home!.firstHalfGoals!,
    htAway: ts.away!.firstHalfGoals!,
    matchHtTotal: halves.htTotal,
    match2hTotal: halves.h2Total,
    cornersHome: ts.home!.corners!,
    cornersAway: ts.away!.corners!,
    goalTimingJson: JSON.stringify(ts.goalTiming ?? {}),
    providerFixtureId: opts?.providerFixtureId ?? match.apiFixtureId ?? null,
    coreFixtureId: opts?.coreFixtureId ?? null,
    source: "prediction_log_batch",
    filledAt: now,
    updatedAt: now,
  };
}

async function resolveFixtureIds(
  batch: PredictionBatch,
  match: LogMatch
): Promise<{ coreFixtureId: number | null; providerFixtureId: number | null }> {
  const db = await getDb();
  let providerFixtureId = match.apiFixtureId ?? null;
  let coreFixtureId: number | null = null;

  const traceRows = await db
    .select()
    .from(coreResultTrace)
    .where(
      and(
        eq(coreResultTrace.batchId, batch.id),
        eq(coreResultTrace.matchId, match.id)
      )
    )
    .limit(1);

  if (traceRows[0]?.providerFixtureId != null) {
    providerFixtureId = traceRows[0].providerFixtureId;
  }
  if (traceRows[0]?.coreFixtureId != null) {
    coreFixtureId = traceRows[0].coreFixtureId;
  }

  if (providerFixtureId != null && coreFixtureId == null) {
    const fx = await db
      .select({ id: coreFixture.id })
      .from(coreFixture)
      .where(
        and(
          eq(coreFixture.providerName, "api-sports"),
          eq(coreFixture.providerFixtureId, providerFixtureId)
        )
      )
      .limit(1);
    coreFixtureId = fx[0]?.id ?? null;
  }

  return { coreFixtureId, providerFixtureId };
}

async function upsertCoreFixtureFromSettlement(
  coreFixtureId: number,
  match: LogMatch,
  now: Date
): Promise<void> {
  const ts = match.teamStats!;
  const db = await getDb();
  const existing = await db
    .select()
    .from(coreFixture)
    .where(eq(coreFixture.id, coreFixtureId))
    .limit(1);
  if (!existing[0] || existing[0].manualVerified === 1) return;

  await db
    .update(coreFixture)
    .set({
      htHome: ts.home!.firstHalfGoals!,
      htAway: ts.away!.firstHalfGoals!,
      ftHome: ts.home!.goals!,
      ftAway: ts.away!.goals!,
      sourceUpdatedAt: now,
    })
    .where(eq(coreFixture.id, coreFixtureId));

  for (const side of ["home", "away"] as const) {
    const corners = side === "home" ? ts.home!.corners! : ts.away!.corners!;
    const statRows = await db
      .select()
      .from(coreFixtureStatistic)
      .where(
        and(
          eq(coreFixtureStatistic.fixtureId, coreFixtureId),
          eq(coreFixtureStatistic.side, side),
          eq(coreFixtureStatistic.statKey, "corners")
        )
      )
      .limit(1);

    if (statRows[0]?.manualVerified === 1) continue;

    if (statRows[0]) {
      await db
        .update(coreFixtureStatistic)
        .set({ statValue: corners, sourceUpdatedAt: now })
        .where(eq(coreFixtureStatistic.id, statRows[0].id));
    } else {
      await db.insert(coreFixtureStatistic).values({
        fixtureId: coreFixtureId,
        side,
        statKey: "corners",
        statValue: corners,
        manualVerified: 0,
        sourceUpdatedAt: now,
      });
    }
  }
}

async function extendTraceEvidence(
  batch: PredictionBatch,
  match: LogMatch,
  row: NewPredictionLogSettlement,
  now: Date
): Promise<void> {
  const db = await getDb();
  const traceRows = await db
    .select()
    .from(coreResultTrace)
    .where(
      and(
        eq(coreResultTrace.batchId, batch.id),
        eq(coreResultTrace.matchId, match.id)
      )
    )
    .limit(1);
  if (!traceRows[0]) return;

  let evidence: Record<string, unknown> = {};
  try {
    evidence = JSON.parse(traceRows[0].evidenceJson ?? "{}") as Record<
      string,
      unknown
    >;
  } catch {
    evidence = {};
  }

  evidence.settlementSnapshot = {
    ftHome: row.ftHome,
    ftAway: row.ftAway,
    htHome: row.htHome,
    htAway: row.htAway,
    matchHtTotal: row.matchHtTotal,
    match2hTotal: row.match2hTotal,
    cornersHome: row.cornersHome,
    cornersAway: row.cornersAway,
    goalTiming: row.goalTimingJson ? JSON.parse(row.goalTimingJson) : null,
    persistedAt: now.toISOString(),
  };

  await db
    .update(coreResultTrace)
    .set({
      evidenceJson: JSON.stringify(evidence),
      updatedAt: now,
    })
    .where(eq(coreResultTrace.id, traceRows[0].id));
}

export async function persistRichSettlementBatch(
  batch: PredictionBatch
): Promise<{ persisted: number }> {
  if (!batchAllMatchesRichSettlement(batch)) {
    return { persisted: 0 };
  }

  const db = await getDb();
  const now = new Date();
  let persisted = 0;

  for (const match of batch.matches) {
    const { coreFixtureId, providerFixtureId } = await resolveFixtureIds(
      batch,
      match
    );
    const row = settlementRowFromMatch(batch, match, {
      coreFixtureId,
      providerFixtureId,
      now,
    });
    if (!row) continue;

    await db
      .insert(predictionLogSettlement)
      .values(row)
      .onConflictDoUpdate({
        target: [
          predictionLogSettlement.batchId,
          predictionLogSettlement.matchId,
        ],
        set: {
          league: row.league,
          homeTeam: row.homeTeam,
          awayTeam: row.awayTeam,
          matchDate: row.matchDate,
          ftHome: row.ftHome,
          ftAway: row.ftAway,
          htHome: row.htHome,
          htAway: row.htAway,
          matchHtTotal: row.matchHtTotal,
          match2hTotal: row.match2hTotal,
          cornersHome: row.cornersHome,
          cornersAway: row.cornersAway,
          goalTimingJson: row.goalTimingJson,
          providerFixtureId: row.providerFixtureId,
          coreFixtureId: row.coreFixtureId,
          source: row.source,
          updatedAt: now,
        },
      });

    if (coreFixtureId != null) {
      await upsertCoreFixtureFromSettlement(coreFixtureId, match, now);
    }
    await extendTraceEvidence(batch, match, row, now);
    persisted++;
  }

  return { persisted };
}
