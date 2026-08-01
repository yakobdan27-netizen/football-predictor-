/**
 * Soft-pull API-Football odds + fixture statistics for Decision Maker.
 * Never blocks DM; never invents numbers; writes only into returned payload
 * (caller may merge into prediction-log KV batch — not live_* / bet_*).
 */
import { apiClientGet } from "@/lib/apiClient";
import { AF_PREFERRED_BOOKMAKER_ID } from "@/lib/bets/constants";

export type DmAfOddsMarket = {
  marketType: string;
  selectionLabel: string;
  odd: number | null;
  bookmaker: string | null;
};

export type DmAfEnrichment = {
  ok: boolean;
  fixtureId: number;
  odds: DmAfOddsMarket[];
  stats: {
    homeCorners: number | null;
    awayCorners: number | null;
    homeShots: number | null;
    awayShots: number | null;
    homePossession: number | null;
    awayPossession: number | null;
  } | null;
  error?: string;
  plan_gated?: boolean;
};

type AfOddValue = { value?: string; odd?: string | number };
type AfBet = { id?: number; name?: string; values?: AfOddValue[] };
type AfBookmaker = { id?: number; name?: string; bets?: AfBet[] };
type AfOddsRow = { bookmakers?: AfBookmaker[] };

type AfStatItem = { type?: string; value?: string | number | null };
type AfStatsRow = {
  team?: { id?: number };
  statistics?: AfStatItem[];
};

function parseOdd(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 1 ? n : null;
}

function parseStatInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  const s = String(v).replace("%", "").trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function mapOdds(rows: AfOddsRow[] | null): DmAfOddsMarket[] {
  const bookmakers = rows?.[0]?.bookmakers ?? [];
  const bookie =
    bookmakers.find((b) => b.id === AF_PREFERRED_BOOKMAKER_ID) ?? bookmakers[0];
  if (!bookie?.bets?.length) return [];
  const out: DmAfOddsMarket[] = [];
  for (const bet of bookie.bets) {
    const name = (bet.name ?? "").toLowerCase();
    for (const v of bet.values ?? []) {
      const label = (v.value ?? "").trim();
      const odd = parseOdd(v.odd);
      if (
        name.includes("match winner") ||
        name === "1x2" ||
        name.includes("full time result")
      ) {
        if (/^home$/i.test(label) || label === "1") {
          out.push({
            marketType: "1X2",
            selectionLabel: "Home",
            odd,
            bookmaker: bookie.name ?? null,
          });
        } else if (/^draw$/i.test(label) || label === "X") {
          out.push({
            marketType: "1X2",
            selectionLabel: "Draw",
            odd,
            bookmaker: bookie.name ?? null,
          });
        } else if (/^away$/i.test(label) || label === "2") {
          out.push({
            marketType: "1X2",
            selectionLabel: "Away",
            odd,
            bookmaker: bookie.name ?? null,
          });
        }
      } else if (name.includes("goals over/under") || name.includes("over/under")) {
        if (/over\s*2\.5/i.test(label)) {
          out.push({
            marketType: "OU_2_5",
            selectionLabel: "Over",
            odd,
            bookmaker: bookie.name ?? null,
          });
        } else if (/under\s*2\.5/i.test(label)) {
          out.push({
            marketType: "OU_2_5",
            selectionLabel: "Under",
            odd,
            bookmaker: bookie.name ?? null,
          });
        }
      } else if (name.includes("both teams score") || name.includes("btts")) {
        if (/^yes$/i.test(label)) {
          out.push({
            marketType: "BTTS",
            selectionLabel: "Yes",
            odd,
            bookmaker: bookie.name ?? null,
          });
        } else if (/^no$/i.test(label)) {
          out.push({
            marketType: "BTTS",
            selectionLabel: "No",
            odd,
            bookmaker: bookie.name ?? null,
          });
        }
      }
    }
  }
  return out;
}

function mapStats(
  rows: AfStatsRow[] | null
): DmAfEnrichment["stats"] {
  if (!rows?.length) return null;
  const home = rows[0]?.statistics ?? [];
  const away = rows[1]?.statistics ?? [];
  const find = (stats: AfStatItem[], type: string) => {
    const hit = stats.find((s) =>
      (s.type ?? "").toLowerCase().includes(type.toLowerCase())
    );
    return parseStatInt(hit?.value);
  };
  return {
    homeCorners: find(home, "Corner"),
    awayCorners: find(away, "Corner"),
    homeShots: find(home, "Total Shots") ?? find(home, "Shots"),
    awayShots: find(away, "Total Shots") ?? find(away, "Shots"),
    homePossession: find(home, "Ball Possession"),
    awayPossession: find(away, "Ball Possession"),
  };
}

/** Soft enrich — failures return empty odds/stats, never throw. */
export async function fetchDmAfEnrichment(
  fixtureId: number
): Promise<DmAfEnrichment> {
  if (!Number.isFinite(fixtureId) || fixtureId <= 0) {
    return {
      ok: false,
      fixtureId,
      odds: [],
      stats: null,
      error: "Invalid fixture id",
    };
  }

  const oddsRes = await apiClientGet<AfOddsRow[]>(
    "/odds",
    { fixture: fixtureId, bookmaker: AF_PREFERRED_BOOKMAKER_ID },
    { cache: "odds" }
  );
  let odds = oddsRes.ok ? mapOdds(oddsRes.data) : [];
  if (!odds.length && oddsRes.ok) {
    const all = await apiClientGet<AfOddsRow[]>(
      "/odds",
      { fixture: fixtureId },
      { cache: "odds" }
    );
    if (all.ok) odds = mapOdds(all.data);
  }

  const statsRes = await apiClientGet<AfStatsRow[]>(
    "/fixtures/statistics",
    { fixture: fixtureId },
    { cache: "team_stats" }
  );

  const planGated = Boolean(oddsRes.plan_gated || statsRes.plan_gated);
  const error =
    !oddsRes.ok && !statsRes.ok
      ? oddsRes.error ?? statsRes.error ?? "AF enrich failed"
      : undefined;

  return {
    ok: odds.length > 0 || statsRes.ok,
    fixtureId,
    odds,
    stats: statsRes.ok ? mapStats(statsRes.data) : null,
    error,
    plan_gated: planGated,
  };
}
