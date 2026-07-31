/**
 * Postgres store for bet_* tables only.
 * Must not import prediction-log / manual-results.
 */
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  betEvents,
  betMarkets,
  betSelections,
  betSlips,
  type BetEvent,
  type BetMarket,
  type BetSelection,
  type BetSlip,
  type NewBetEvent,
  type NewBetMarket,
} from "@/lib/db/schema";
import type { BetFeedType, BetMarketSource, BetSlipType } from "./constants";
import { QUICK_MARKET_DEFS } from "./constants";

export async function upsertBetEventFromLive(input: {
  apiFixtureId: number;
  leagueId: number;
  home: string;
  away: string;
  kickoffUtc: Date;
  status: string;
  minute: number | null;
  homeScore: number | null;
  awayScore: number | null;
  feedType: BetFeedType;
}): Promise<BetEvent> {
  const db = await getDb();
  const now = new Date();
  const existing = await db
    .select()
    .from(betEvents)
    .where(eq(betEvents.apiFixtureId, input.apiFixtureId))
    .limit(1);

  if (existing[0]) {
    const [row] = await db
      .update(betEvents)
      .set({
        leagueId: input.leagueId,
        home: input.home,
        away: input.away,
        kickoffUtc: input.kickoffUtc,
        status: input.status,
        minute: input.minute,
        homeScore: input.homeScore,
        awayScore: input.awayScore,
        feedType: input.feedType,
        lastSyncedAt: now,
      })
      .where(eq(betEvents.id, existing[0].id))
      .returning();
    return row!;
  }

  const values: NewBetEvent = {
    apiFixtureId: input.apiFixtureId,
    leagueId: input.leagueId,
    home: input.home,
    away: input.away,
    kickoffUtc: input.kickoffUtc,
    status: input.status,
    minute: input.minute,
    homeScore: input.homeScore,
    awayScore: input.awayScore,
    feedType: input.feedType,
    lastSyncedAt: now,
  };
  const [row] = await db.insert(betEvents).values(values).returning();
  return row!;
}

export async function getBetEventByApiFixtureId(
  apiFixtureId: number
): Promise<BetEvent | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(betEvents)
    .where(eq(betEvents.apiFixtureId, apiFixtureId))
    .limit(1);
  return row ?? null;
}

export async function getBetEventById(id: number): Promise<BetEvent | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(betEvents)
    .where(eq(betEvents.id, id))
    .limit(1);
  return row ?? null;
}

export async function listMarketsForEvent(
  betEventId: number
): Promise<BetMarket[]> {
  const db = await getDb();
  return db
    .select()
    .from(betMarkets)
    .where(eq(betMarkets.betEventId, betEventId))
    .orderBy(asc(betMarkets.id));
}

/** Ensure quick-pick MANUAL skeleton markets exist when odds missing. */
export async function ensureManualSkeletonMarkets(
  betEventId: number
): Promise<BetMarket[]> {
  const existing = await listMarketsForEvent(betEventId);
  const key = (m: BetMarket) => `${m.marketType}::${m.selectionLabel}`;
  const have = new Set(existing.map(key));
  const db = await getDb();
  const now = new Date();
  const toInsert: NewBetMarket[] = [];

  for (const def of QUICK_MARKET_DEFS) {
    const k = `${def.marketType}::${def.selectionLabel}`;
    if (have.has(k)) continue;
    toInsert.push({
      betEventId,
      marketType: def.marketType,
      selectionLabel: def.selectionLabel,
      odd: null,
      isAvailable: 1,
      source: "MANUAL",
      updatedAt: now,
    });
  }

  if (toInsert.length) {
    await db.insert(betMarkets).values(toInsert);
  }
  return listMarketsForEvent(betEventId);
}

export async function replaceApiMarketsForEvent(
  betEventId: number,
  rows: Array<{
    marketType: string;
    selectionLabel: string;
    odd: number | null;
  }>
): Promise<BetMarket[]> {
  const db = await getDb();
  const now = new Date();
  await db.delete(betMarkets).where(eq(betMarkets.betEventId, betEventId));

  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const k = `${r.marketType}::${r.selectionLabel}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (unique.length) {
    await db.insert(betMarkets).values(
      unique.map((r) => ({
        betEventId,
        marketType: r.marketType,
        selectionLabel: r.selectionLabel,
        odd: r.odd,
        isAvailable: r.odd != null ? 1 : 0,
        source: (r.odd != null ? "API" : "MANUAL") as BetMarketSource,
        updatedAt: now,
      }))
    );
  }

  return ensureManualSkeletonMarkets(betEventId);
}

export async function updateMarketOdd(
  marketId: number,
  odd: number | null
): Promise<BetMarket | null> {
  const db = await getDb();
  const [row] = await db
    .update(betMarkets)
    .set({
      odd,
      source: "MANUAL",
      isAvailable: 1,
      updatedAt: new Date(),
    })
    .where(eq(betMarkets.id, marketId))
    .returning();
  return row ?? null;
}

export async function getMarketById(id: number): Promise<BetMarket | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(betMarkets)
    .where(eq(betMarkets.id, id))
    .limit(1);
  return row ?? null;
}

export type PlaceSelectionInput = {
  betEventId: number;
  marketId: number;
  chosenLabel: string;
  chosenOdd: number;
  stake?: number;
};

export async function createSingleSlips(
  selections: PlaceSelectionInput[]
): Promise<BetSlip[]> {
  const db = await getDb();
  const now = new Date();
  const out: BetSlip[] = [];

  for (const sel of selections) {
    const stake = sel.stake ?? 0;
    const totalOdd = sel.chosenOdd;
    const [slip] = await db
      .insert(betSlips)
      .values({
        createdAt: now,
        slipType: "SINGLE",
        stake,
        totalOdd,
        potentialReturn: Math.round(stake * totalOdd * 100) / 100,
        status: "OPEN",
        settledAt: null,
        note: null,
      })
      .returning();
    await db.insert(betSelections).values({
      betSlipId: slip!.id,
      betEventId: sel.betEventId,
      marketId: sel.marketId,
      chosenLabel: sel.chosenLabel,
      chosenOdd: sel.chosenOdd,
      result: "PENDING",
      settledAt: null,
    });
    out.push(slip!);
  }
  return out;
}

export async function createMultiSlip(
  selections: PlaceSelectionInput[],
  stake: number
): Promise<BetSlip> {
  const db = await getDb();
  const now = new Date();
  const totalOdd = selections.reduce((acc, s) => acc * s.chosenOdd, 1);
  const [slip] = await db
    .insert(betSlips)
    .values({
      createdAt: now,
      slipType: "MULTI" satisfies BetSlipType,
      stake,
      totalOdd: Math.round(totalOdd * 10000) / 10000,
      potentialReturn: Math.round(stake * totalOdd * 100) / 100,
      status: "OPEN",
      settledAt: null,
      note: null,
    })
    .returning();

  await db.insert(betSelections).values(
    selections.map((sel) => ({
      betSlipId: slip!.id,
      betEventId: sel.betEventId,
      marketId: sel.marketId,
      chosenLabel: sel.chosenLabel,
      chosenOdd: sel.chosenOdd,
      result: "PENDING",
      settledAt: null,
    }))
  );
  return slip!;
}

export type SlipWithSelections = BetSlip & {
  selections: Array<
    BetSelection & {
      event: BetEvent | null;
      market: BetMarket | null;
    }
  >;
};

export async function listSlipsByStatus(
  statusGroup: "OPEN" | "SETTLED"
): Promise<SlipWithSelections[]> {
  const db = await getDb();
  const slips =
    statusGroup === "OPEN"
      ? await db
          .select()
          .from(betSlips)
          .where(eq(betSlips.status, "OPEN"))
          .orderBy(desc(betSlips.createdAt))
          .limit(100)
      : await db
          .select()
          .from(betSlips)
          .where(ne(betSlips.status, "OPEN"))
          .orderBy(desc(betSlips.settledAt), desc(betSlips.createdAt))
          .limit(100);

  if (!slips.length) return [];

  const slipIds = slips.map((s) => s.id);
  const sels = await db
    .select()
    .from(betSelections)
    .where(inArray(betSelections.betSlipId, slipIds));

  const eventIds = [...new Set(sels.map((s) => s.betEventId))];
  const marketIds = [...new Set(sels.map((s) => s.marketId))];

  const events = eventIds.length
    ? await db.select().from(betEvents).where(inArray(betEvents.id, eventIds))
    : [];
  const markets = marketIds.length
    ? await db
        .select()
        .from(betMarkets)
        .where(inArray(betMarkets.id, marketIds))
    : [];

  const eventById = new Map(events.map((e) => [e.id, e]));
  const marketById = new Map(markets.map((m) => [m.id, m]));

  return slips.map((slip) => ({
    ...slip,
    selections: sels
      .filter((s) => s.betSlipId === slip.id)
      .map((s) => ({
        ...s,
        event: eventById.get(s.betEventId) ?? null,
        market: marketById.get(s.marketId) ?? null,
      })),
  }));
}

export async function listPendingSelectionsForApiFixture(
  apiFixtureId: number
): Promise<
  Array<{
    selection: BetSelection;
    market: BetMarket;
    slip: BetSlip;
    event: BetEvent;
  }>
> {
  const event = await getBetEventByApiFixtureId(apiFixtureId);
  if (!event) return [];
  const db = await getDb();
  const sels = await db
    .select()
    .from(betSelections)
    .where(
      and(
        eq(betSelections.betEventId, event.id),
        eq(betSelections.result, "PENDING")
      )
    );
  if (!sels.length) return [];

  const marketIds = [...new Set(sels.map((s) => s.marketId))];
  const slipIds = [...new Set(sels.map((s) => s.betSlipId))];
  const markets = await db
    .select()
    .from(betMarkets)
    .where(inArray(betMarkets.id, marketIds));
  const slips = await db
    .select()
    .from(betSlips)
    .where(inArray(betSlips.id, slipIds));
  const marketById = new Map(markets.map((m) => [m.id, m]));
  const slipById = new Map(slips.map((s) => [s.id, s]));

  return sels
    .map((selection) => {
      const market = marketById.get(selection.marketId);
      const slip = slipById.get(selection.betSlipId);
      if (!market || !slip) return null;
      return { selection, market, slip, event };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
}

export async function updateSelectionResult(
  selectionId: number,
  result: string
): Promise<void> {
  const db = await getDb();
  await db
    .update(betSelections)
    .set({ result, settledAt: new Date() })
    .where(eq(betSelections.id, selectionId));
}

export async function getSelectionsForSlip(
  slipId: number
): Promise<BetSelection[]> {
  const db = await getDb();
  return db
    .select()
    .from(betSelections)
    .where(eq(betSelections.betSlipId, slipId));
}

export async function updateSlipSettlement(
  slipId: number,
  patch: {
    status: string;
    totalOdd?: number;
    potentialReturn?: number;
    note?: string | null;
  }
): Promise<void> {
  const db = await getDb();
  const set: Record<string, unknown> = {
    status: patch.status,
    settledAt: new Date(),
  };
  if (patch.totalOdd != null) set.totalOdd = patch.totalOdd;
  if (patch.potentialReturn != null) set.potentialReturn = patch.potentialReturn;
  if (patch.note !== undefined) set.note = patch.note;
  await db.update(betSlips).set(set).where(eq(betSlips.id, slipId));
}

export async function listOpenApiFixtureIdsWithPending(): Promise<number[]> {
  const db = await getDb();
  const rows = await db
    .select({
      apiFixtureId: betEvents.apiFixtureId,
    })
    .from(betSelections)
    .innerJoin(betEvents, eq(betSelections.betEventId, betEvents.id))
    .innerJoin(betSlips, eq(betSelections.betSlipId, betSlips.id))
    .where(
      and(eq(betSelections.result, "PENDING"), eq(betSlips.status, "OPEN"))
    );
  return [...new Set(rows.map((r) => r.apiFixtureId))];
}
