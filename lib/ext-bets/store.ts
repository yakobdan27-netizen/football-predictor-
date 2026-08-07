/**
 * Postgres store for ext_* tables only.
 * Never writes bet_slips / prediction-log / manual-results.
 */
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  betEvents,
  betMarkets,
  extSelections,
  extSlips,
  extUsers,
  type ExtSelection,
  type ExtSlip,
  type ExtUser,
} from "@/lib/db/schema";
import { normalizePhoneOrCode } from "./phone";

export async function upsertExtUser(input: {
  phone: string;
  displayName?: string | null;
}): Promise<ExtUser> {
  const phone = normalizePhoneOrCode(input.phone);
  if (!phone) throw new Error("Invalid phone or access code");

  const db = await getDb();
  const now = new Date();
  const existing = await db
    .select()
    .from(extUsers)
    .where(eq(extUsers.phone, phone))
    .limit(1);

  if (existing[0]) {
    const [row] = await db
      .update(extUsers)
      .set({
        lastSeenAt: now,
        displayName:
          input.displayName?.trim() || existing[0].displayName || null,
      })
      .where(eq(extUsers.id, existing[0].id))
      .returning();
    return row!;
  }

  const [row] = await db
    .insert(extUsers)
    .values({
      phone,
      displayName: input.displayName?.trim() || null,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .returning();
  return row!;
}

export async function getExtUserById(id: number): Promise<ExtUser | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(extUsers)
    .where(eq(extUsers.id, id))
    .limit(1);
  return row ?? null;
}

export type ExtSelectionInput = {
  betEventId: number;
  marketId: number;
  chosenLabel: string;
  chosenOdd: number;
  eventLabel?: string;
  marketLabel?: string;
};

export async function createExtSlip(input: {
  extUserId: number;
  slipType: "SINGLE" | "MULTI";
  stake: number;
  note?: string | null;
  selections: ExtSelectionInput[];
}): Promise<{ slip: ExtSlip; selections: ExtSelection[] }> {
  if (!input.selections.length) throw new Error("No selections");
  if (!(input.stake > 0)) throw new Error("Stake must be positive");

  const db = await getDb();
  const now = new Date();

  const enriched: ExtSelectionInput[] = [];
  for (const sel of input.selections) {
    const [ev] = await db
      .select()
      .from(betEvents)
      .where(eq(betEvents.id, sel.betEventId))
      .limit(1);
    const [mkt] = await db
      .select()
      .from(betMarkets)
      .where(eq(betMarkets.id, sel.marketId))
      .limit(1);
    const eventLabel =
      sel.eventLabel ||
      (ev ? `${ev.home} vs ${ev.away}` : `Event #${sel.betEventId}`);
    const marketLabel =
      sel.marketLabel ||
      (mkt
        ? `${mkt.marketType} ${mkt.selectionLabel}`
        : sel.chosenLabel);
    const odd =
      Number.isFinite(sel.chosenOdd) && sel.chosenOdd >= 1
        ? sel.chosenOdd
        : 1;
    enriched.push({
      ...sel,
      chosenOdd: odd,
      eventLabel,
      marketLabel,
    });
  }

  const totalOdd = enriched.reduce((acc, s) => acc * s.chosenOdd, 1);
  const potentialReturn = Math.round(input.stake * totalOdd * 100) / 100;

  const [slip] = await db
    .insert(extSlips)
    .values({
      extUserId: input.extUserId,
      createdAt: now,
      slipType: input.slipType,
      stake: input.stake,
      totalOdd: Math.round(totalOdd * 10000) / 10000,
      potentialReturn,
      note: input.note ?? null,
      status: "SUBMITTED",
    })
    .returning();

  const sels = await db
    .insert(extSelections)
    .values(
      enriched.map((s) => ({
        extSlipId: slip!.id,
        betEventId: s.betEventId,
        marketId: s.marketId,
        eventLabel: s.eventLabel!,
        marketLabel: s.marketLabel!,
        chosenLabel: s.chosenLabel,
        chosenOdd: s.chosenOdd,
        result: "PENDING",
      }))
    )
    .returning();

  return { slip: slip!, selections: sels };
}

export async function listExtSlipsForUser(extUserId: number) {
  const db = await getDb();
  const slips = await db
    .select()
    .from(extSlips)
    .where(eq(extSlips.extUserId, extUserId))
    .orderBy(desc(extSlips.createdAt));

  const out = [];
  for (const slip of slips) {
    const selections = await db
      .select()
      .from(extSelections)
      .where(eq(extSelections.extSlipId, slip.id));
    out.push({ slip, selections });
  }
  return out;
}

export type AdminSlipFilters = {
  phone?: string;
  status?: string;
  from?: Date;
  to?: Date;
  leagueId?: number;
};

export async function listAllExtSlipsForAdmin(filters: AdminSlipFilters = {}) {
  const db = await getDb();
  const conditions = [];
  if (filters.status) {
    conditions.push(eq(extSlips.status, filters.status));
  }
  if (filters.from) {
    conditions.push(gte(extSlips.createdAt, filters.from));
  }
  if (filters.to) {
    conditions.push(lte(extSlips.createdAt, filters.to));
  }

  const slips = await db
    .select({
      slip: extSlips,
      user: extUsers,
    })
    .from(extSlips)
    .innerJoin(extUsers, eq(extSlips.extUserId, extUsers.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(extSlips.createdAt));

  const phoneQ = filters.phone?.trim().toLowerCase();
  const filtered = phoneQ
    ? slips.filter(
        (r) =>
          r.user.phone.toLowerCase().includes(phoneQ) ||
          (r.user.displayName ?? "").toLowerCase().includes(phoneQ)
      )
    : slips;

  const out = [];
  for (const row of filtered) {
    const selections = await db
      .select()
      .from(extSelections)
      .where(eq(extSelections.extSlipId, row.slip.id));

    if (filters.leagueId != null) {
      const eventIds = selections
        .map((s) => s.betEventId)
        .filter((id): id is number => id != null);
      if (!eventIds.length) continue;
      let leagueHit = false;
      for (const id of eventIds) {
        const [ev] = await db
          .select()
          .from(betEvents)
          .where(eq(betEvents.id, id))
          .limit(1);
        if (ev?.leagueId === filters.leagueId) {
          leagueHit = true;
          break;
        }
      }
      if (!leagueHit) continue;
    }

    out.push({
      slip: row.slip,
      user: row.user,
      selections,
    });
  }
  return out;
}

export async function adminSummary() {
  const db = await getDb();
  const [totals] = await db
    .select({
      slips: sql<number>`count(*)::int`,
      users: sql<number>`count(distinct ${extSlips.extUserId})::int`,
    })
    .from(extSlips);

  const [open] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(extSlips)
    .where(eq(extSlips.status, "SUBMITTED"));

  const [settled] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(extSlips)
    .where(sql`${extSlips.status} in ('WON','LOST','VOID')`);

  return {
    totalSubmissions: totals?.slips ?? 0,
    uniquePhones: totals?.users ?? 0,
    open: open?.n ?? 0,
    settled: settled?.n ?? 0,
  };
}

export async function voidExtSlip(slipId: number): Promise<ExtSlip | null> {
  const db = await getDb();
  const now = new Date();
  await db
    .update(extSelections)
    .set({ result: "VOID", settledAt: now })
    .where(eq(extSelections.extSlipId, slipId));
  const [row] = await db
    .update(extSlips)
    .set({ status: "VOID", settledAt: now })
    .where(eq(extSlips.id, slipId))
    .returning();
  return row ?? null;
}

export async function listPendingExtSelectionsForApiFixture(
  apiFixtureId: number
) {
  const db = await getDb();
  const [ev] = await db
    .select()
    .from(betEvents)
    .where(eq(betEvents.apiFixtureId, apiFixtureId))
    .limit(1);
  if (!ev) return [];

  const rows = await db
    .select({
      selection: extSelections,
      slip: extSlips,
      market: betMarkets,
    })
    .from(extSelections)
    .innerJoin(extSlips, eq(extSelections.extSlipId, extSlips.id))
    .leftJoin(betMarkets, eq(extSelections.marketId, betMarkets.id))
    .where(
      and(
        eq(extSelections.betEventId, ev.id),
        eq(extSelections.result, "PENDING"),
        eq(extSlips.status, "SUBMITTED")
      )
    );

  return rows.map((r) => ({
    selection: r.selection,
    slip: r.slip,
    marketType: r.market?.marketType ?? r.selection.marketLabel.split(" ")[0] ?? "UNKNOWN",
    event: ev,
  }));
}

export async function updateExtSelectionResult(
  id: number,
  result: string
): Promise<void> {
  const db = await getDb();
  await db
    .update(extSelections)
    .set({ result, settledAt: new Date() })
    .where(eq(extSelections.id, id));
}

export async function updateExtSlipSettlement(
  slipId: number,
  patch: {
    status: string;
    totalOdd?: number;
    potentialReturn?: number;
    note?: string | null;
  }
): Promise<void> {
  const db = await getDb();
  await db
    .update(extSlips)
    .set({
      status: patch.status,
      totalOdd: patch.totalOdd,
      potentialReturn: patch.potentialReturn,
      note: patch.note,
      settledAt: new Date(),
    })
    .where(eq(extSlips.id, slipId));
}

export async function getExtSelectionsForSlip(
  slipId: number
): Promise<ExtSelection[]> {
  const db = await getDb();
  return db
    .select()
    .from(extSelections)
    .where(eq(extSelections.extSlipId, slipId));
}

export async function listOpenExtApiFixtureIdsWithPending(): Promise<number[]> {
  const db = await getDb();
  const rows = await db
    .select({
      apiFixtureId: betEvents.apiFixtureId,
    })
    .from(extSelections)
    .innerJoin(extSlips, eq(extSelections.extSlipId, extSlips.id))
    .innerJoin(betEvents, eq(extSelections.betEventId, betEvents.id))
    .where(
      and(
        eq(extSelections.result, "PENDING"),
        eq(extSlips.status, "SUBMITTED")
      )
    );
  return [...new Set(rows.map((r) => r.apiFixtureId))];
}
