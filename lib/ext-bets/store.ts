/**
 * Postgres store for ext_* tables only.
 * Never writes bet_slips / prediction-log / manual-results.
 */
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
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
import { LEAGUE_API_IDS } from "@/lib/football-api/leagues";
import { normalizePhoneOrCode } from "./phone";

const LEAGUE_NAME_BY_ID = Object.fromEntries(
  Object.entries(LEAGUE_API_IDS).map(([name, id]) => [id, name])
) as Record<number, string>;

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

export type AdminUserFilters = {
  q?: string;
  from?: Date;
  to?: Date;
  /** Filter on last_seen_at (default) or first_seen_at */
  dateField?: "lastSeen" | "firstSeen";
  minSlipCount?: number;
};

export type ExtUserAdminRow = {
  id: number;
  phone: string;
  displayName: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  totalSlips: number;
  submitted: number;
  won: number;
  lost: number;
  voided: number;
  /** sum(potential_return for WON) − sum(stake for LOST) */
  netResult: number;
};

export async function listExtUsersForAdmin(
  filters: AdminUserFilters = {}
): Promise<ExtUserAdminRow[]> {
  const db = await getDb();
  const dateCol =
    filters.dateField === "firstSeen"
      ? extUsers.firstSeenAt
      : extUsers.lastSeenAt;

  const conditions = [];
  if (filters.from) {
    conditions.push(gte(dateCol, filters.from));
  }
  if (filters.to) {
    conditions.push(lte(dateCol, filters.to));
  }
  const q = filters.q?.trim();
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(ilike(extUsers.phone, pattern), ilike(extUsers.displayName, pattern))
    );
  }

  const rows = await db
    .select({
      id: extUsers.id,
      phone: extUsers.phone,
      displayName: extUsers.displayName,
      firstSeenAt: extUsers.firstSeenAt,
      lastSeenAt: extUsers.lastSeenAt,
      totalSlips: sql<number>`coalesce(count(${extSlips.id}), 0)::int`,
      submitted: sql<number>`coalesce(sum(case when ${extSlips.status} = 'SUBMITTED' then 1 else 0 end), 0)::int`,
      won: sql<number>`coalesce(sum(case when ${extSlips.status} = 'WON' then 1 else 0 end), 0)::int`,
      lost: sql<number>`coalesce(sum(case when ${extSlips.status} = 'LOST' then 1 else 0 end), 0)::int`,
      voided: sql<number>`coalesce(sum(case when ${extSlips.status} = 'VOID' then 1 else 0 end), 0)::int`,
      netResult: sql<number>`coalesce(
        sum(case when ${extSlips.status} = 'WON' then ${extSlips.potentialReturn} else 0 end)
        - sum(case when ${extSlips.status} = 'LOST' then ${extSlips.stake} else 0 end)
      , 0)::float`,
    })
    .from(extUsers)
    .leftJoin(extSlips, eq(extSlips.extUserId, extUsers.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(
      extUsers.id,
      extUsers.phone,
      extUsers.displayName,
      extUsers.firstSeenAt,
      extUsers.lastSeenAt
    )
    .orderBy(desc(extUsers.lastSeenAt));

  const min = filters.minSlipCount ?? 0;
  return rows
    .map((r) => ({
      id: r.id,
      phone: r.phone,
      displayName: r.displayName,
      firstSeenAt: r.firstSeenAt,
      lastSeenAt: r.lastSeenAt,
      totalSlips: r.totalSlips ?? 0,
      submitted: r.submitted ?? 0,
      won: r.won ?? 0,
      lost: r.lost ?? 0,
      voided: r.voided ?? 0,
      netResult: Number(r.netResult ?? 0),
    }))
    .filter((r) => r.totalSlips >= min);
}

export type ExtUserAdminDetail = {
  user: ExtUser;
  stats: {
    totalSlips: number;
    submitted: number;
    won: number;
    lost: number;
    voided: number;
    winRate: number | null;
    avgStake: number;
    netResult: number;
    topLeagues: Array<{ label: string; count: number }>;
    topMarkets: Array<{ label: string; count: number }>;
  };
  slips: Array<{ slip: ExtSlip; selections: ExtSelection[] }>;
};

export async function getExtUserAdminDetail(
  userId: number,
  filters: { status?: string; from?: Date; to?: Date } = {}
): Promise<ExtUserAdminDetail | null> {
  const user = await getExtUserById(userId);
  if (!user) return null;

  let slips = await listExtSlipsForUser(userId);
  if (filters.status) {
    slips = slips.filter((r) => r.slip.status === filters.status);
  }
  if (filters.from) {
    const from = filters.from;
    slips = slips.filter((r) => r.slip.createdAt >= from);
  }
  if (filters.to) {
    const to = filters.to;
    slips = slips.filter((r) => r.slip.createdAt <= to);
  }

  const totalSlips = slips.length;
  const submitted = slips.filter((r) => r.slip.status === "SUBMITTED").length;
  const won = slips.filter((r) => r.slip.status === "WON").length;
  const lost = slips.filter((r) => r.slip.status === "LOST").length;
  const voided = slips.filter((r) => r.slip.status === "VOID").length;
  const decided = won + lost;
  const winRate = decided > 0 ? won / decided : null;
  const avgStake =
    totalSlips > 0
      ? slips.reduce((sum, r) => sum + r.slip.stake, 0) / totalSlips
      : 0;
  const netResult =
    slips
      .filter((r) => r.slip.status === "WON")
      .reduce((sum, r) => sum + r.slip.potentialReturn, 0) -
    slips
      .filter((r) => r.slip.status === "LOST")
      .reduce((sum, r) => sum + r.slip.stake, 0);

  const marketCounts = new Map<string, number>();
  const leagueCounts = new Map<string, number>();
  const db = await getDb();

  for (const { selections } of slips) {
    for (const sel of selections) {
      const mKey = sel.marketLabel.trim() || "Unknown";
      marketCounts.set(mKey, (marketCounts.get(mKey) ?? 0) + 1);

      if (sel.betEventId != null) {
        const [ev] = await db
          .select({ leagueId: betEvents.leagueId })
          .from(betEvents)
          .where(eq(betEvents.id, sel.betEventId))
          .limit(1);
        if (ev) {
          const label =
            LEAGUE_NAME_BY_ID[ev.leagueId] ?? `League ${ev.leagueId}`;
          leagueCounts.set(label, (leagueCounts.get(label) ?? 0) + 1);
        }
      }
    }
  }

  const topN = (m: Map<string, number>, n = 5) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([label, count]) => ({ label, count }));

  return {
    user,
    stats: {
      totalSlips,
      submitted,
      won,
      lost,
      voided,
      winRate,
      avgStake,
      netResult,
      topLeagues: topN(leagueCounts),
      topMarkets: topN(marketCounts),
    },
    slips,
  };
}
