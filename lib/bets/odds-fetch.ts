/**
 * Fetch API-Football /odds and map into bet_markets.
 * Plan-gated / empty → MANUAL skeleton (never invent odds).
 */
import { apiFootballGet } from "@/lib/football-api/client";
import { getFixtureById } from "@/lib/live/store";
import { AF_PREFERRED_BOOKMAKER_ID } from "./constants";
import {
  ensureManualSkeletonMarkets,
  getBetEventByApiFixtureId,
  replaceApiMarketsForEvent,
  upsertBetEventFromLive,
} from "./store";
import type { BetMarket } from "@/lib/db/schema";
import { LIVE_STATUSES } from "@/lib/live/constants";

type AfOddValue = { value?: string; odd?: string | number };
type AfBet = { id?: number; name?: string; values?: AfOddValue[] };
type AfBookmaker = { id?: number; name?: string; bets?: AfBet[] };
type AfOddsRow = {
  league?: { season?: number };
  bookmakers?: AfBookmaker[];
};

function parseOdd(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 1 ? n : null;
}

function mapAfBetToMarkets(
  bet: AfBet
): Array<{ marketType: string; selectionLabel: string; odd: number | null }> {
  const name = (bet.name ?? "").toLowerCase();
  const values = bet.values ?? [];
  const out: Array<{
    marketType: string;
    selectionLabel: string;
    odd: number | null;
  }> = [];

  const push = (marketType: string, selectionLabel: string, odd: number | null) => {
    out.push({ marketType, selectionLabel, odd });
  };

  if (
    name.includes("match winner") ||
    name === "1x2" ||
    name.includes("full time result")
  ) {
    for (const v of values) {
      const label = (v.value ?? "").trim();
      const odd = parseOdd(v.odd);
      if (/^home$/i.test(label) || label === "1") push("1X2", "Home", odd);
      else if (/^draw$/i.test(label) || label === "X") push("1X2", "Draw", odd);
      else if (/^away$/i.test(label) || label === "2") push("1X2", "Away", odd);
    }
    return out;
  }

  if (name.includes("goals over/under") || name.includes("over/under")) {
    for (const v of values) {
      const label = (v.value ?? "").trim();
      const odd = parseOdd(v.odd);
      if (/over\s*2\.5/i.test(label)) push("OU_2_5", "Over", odd);
      else if (/under\s*2\.5/i.test(label)) push("OU_2_5", "Under", odd);
    }
    return out;
  }

  if (name.includes("both teams score") || name.includes("btts")) {
    for (const v of values) {
      const label = (v.value ?? "").trim();
      const odd = parseOdd(v.odd);
      if (/^yes$/i.test(label)) push("BTTS", "Yes", odd);
      else if (/^no$/i.test(label)) push("BTTS", "No", odd);
    }
    return out;
  }

  if (name.includes("double chance")) {
    for (const v of values) {
      const label = (v.value ?? "").trim();
      const odd = parseOdd(v.odd);
      if (/home\/draw|1x/i.test(label)) push("DC", "1X", odd);
      else if (/home\/away|12/i.test(label)) push("DC", "12", odd);
      else if (/draw\/away|x2/i.test(label)) push("DC", "X2", odd);
    }
    return out;
  }

  return out;
}

export type OddsFetchResult = {
  markets: BetMarket[];
  source: "API" | "MANUAL";
  warning?: string;
  bookmaker?: string;
};

export async function fetchAndCacheOddsForFixture(
  apiFixtureId: number
): Promise<OddsFetchResult> {
  const live = await getFixtureById(apiFixtureId);
  if (!live) {
    throw new Error(`Fixture ${apiFixtureId} not found in live_fixtures`);
  }

  const feedType = LIVE_STATUSES.inPlay.has(live.status.toUpperCase())
    ? "LIVE"
    : "PRE";
  const event = await upsertBetEventFromLive({
    apiFixtureId: live.fixtureId,
    leagueId: live.leagueId,
    home: live.homeTeam,
    away: live.awayTeam,
    kickoffUtc: live.kickoffUtc,
    status: live.status,
    minute: live.statusMinute,
    homeScore: live.homeGoals,
    awayScore: live.awayGoals,
    feedType,
  });

  try {
    const rows = await apiFootballGet<AfOddsRow[]>("/odds", {
      fixture: apiFixtureId,
      bookmaker: AF_PREFERRED_BOOKMAKER_ID,
    });

    let bookmakers = rows?.[0]?.bookmakers ?? [];
    if (!bookmakers.length) {
      // Retry without bookmaker filter
      const all = await apiFootballGet<AfOddsRow[]>("/odds", {
        fixture: apiFixtureId,
      });
      bookmakers = all?.[0]?.bookmakers ?? [];
    }

    let bookie =
      bookmakers.find((b) => b.id === AF_PREFERRED_BOOKMAKER_ID) ??
      bookmakers[0];

    if (!bookie?.bets?.length) {
      const markets = await ensureManualSkeletonMarkets(event.id);
      return {
        markets,
        source: "MANUAL",
        warning: "Odds unavailable — enter manually (FILL FROM DB / —)",
      };
    }

    const mapped: Array<{
      marketType: string;
      selectionLabel: string;
      odd: number | null;
    }> = [];
    for (const bet of bookie.bets) {
      mapped.push(...mapAfBetToMarkets(bet));
    }

    // Dedupe by market+label (keep first)
    const seen = new Set<string>();
    const unique = mapped.filter((m) => {
      const k = `${m.marketType}::${m.selectionLabel}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const markets = await replaceApiMarketsForEvent(event.id, unique);
    return {
      markets,
      source: unique.some((m) => m.odd != null) ? "API" : "MANUAL",
      bookmaker: bookie.name,
      warning: unique.some((m) => m.odd == null)
        ? "Some markets missing odds — MANUAL entry available"
        : undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const planGated = /403|plan|subscription|not available/i.test(msg);
    const markets = await ensureManualSkeletonMarkets(event.id);
    return {
      markets,
      source: "MANUAL",
      warning: planGated
        ? "Odds plan-gated — enter odds manually"
        : `Odds fetch failed (${msg}) — enter manually`,
    };
  }
}

export async function getCachedMarketsOrSkeleton(apiFixtureId: number) {
  let event = await getBetEventByApiFixtureId(apiFixtureId);
  if (!event) {
    const live = await getFixtureById(apiFixtureId);
    if (!live) return null;
    event = await upsertBetEventFromLive({
      apiFixtureId: live.fixtureId,
      leagueId: live.leagueId,
      home: live.homeTeam,
      away: live.awayTeam,
      kickoffUtc: live.kickoffUtc,
      status: live.status,
      minute: live.statusMinute,
      homeScore: live.homeGoals,
      awayScore: live.awayGoals,
      feedType: LIVE_STATUSES.inPlay.has(live.status.toUpperCase())
        ? "LIVE"
        : "PRE",
    });
  }
  return ensureManualSkeletonMarkets(event.id);
}
