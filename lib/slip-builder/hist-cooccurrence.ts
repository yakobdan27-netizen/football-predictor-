/**
 * Historical co-occurrence ρ from hist_fixtures for correlation control.
 * Falls back to heuristic when DB unavailable or sample thin.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { HIST_LEAGUES } from "@/lib/hist/seasons";
import type { CandidateLeg, MarketFamilyId } from "./types";
import {
  heuristicRho,
  legOutcomeKey,
  pearsonRho,
  type RhoLookup,
} from "./correlation";

export type HistOutcomeRow = {
  ftHome: number;
  ftAway: number;
  htHome: number | null;
  htAway: number | null;
  cornersHome: number | null;
  cornersAway: number | null;
};

/** Map a family/selection to a binary outcome on a finished fixture. */
export function outcomeHit(
  family: MarketFamilyId,
  selectionKey: string,
  row: HistOutcomeRow
): number | null {
  const h = row.ftHome;
  const a = row.ftAway;
  const th = h + a;
  switch (family) {
    case "RESULT_1X2":
      if (selectionKey === "home") return h > a ? 1 : 0;
      if (selectionKey === "draw") return h === a ? 1 : 0;
      if (selectionKey === "away") return a > h ? 1 : 0;
      return null;
    case "DOUBLE_CHANCE":
      if (selectionKey === "1X") return h >= a ? 1 : 0;
      if (selectionKey === "X2") return a >= h ? 1 : 0;
      if (selectionKey === "12") return h !== a ? 1 : 0;
      return null;
    case "HANDICAP": {
      const parts = selectionKey.split("_");
      const side = parts[0];
      const line = Number(parts.slice(1).join("_"));
      if (!Number.isFinite(line)) return null;
      const v = h - a + line;
      if (v === 0) return null;
      if (side === "home") return v > 0 ? 1 : 0;
      if (side === "away") return v < 0 ? 1 : 0;
      return null;
    }
    case "TOTALS": {
      const under = selectionKey.startsWith("under");
      const line = Number(selectionKey.replace(/^(over|under)_/, ""));
      if (!Number.isFinite(line)) return null;
      return under ? (th < line ? 1 : 0) : th > line ? 1 : 0;
    }
    case "TEAM_GOALS": {
      if (selectionKey === "home_cs") return a === 0 ? 1 : 0;
      if (selectionKey === "away_cs") return h === 0 ? 1 : 0;
      const isHome = selectionKey.startsWith("home_");
      const isOver = selectionKey.includes("_over_");
      const line = Number(selectionKey.replace(/^.*(over|under)_/, ""));
      if (!Number.isFinite(line)) return null;
      const g = isHome ? h : a;
      return isOver ? (g > line ? 1 : 0) : g < line ? 1 : 0;
    }
    case "BTTS":
      if (selectionKey === "yes") return h >= 1 && a >= 1 ? 1 : 0;
      if (selectionKey === "no") return h === 0 || a === 0 ? 1 : 0;
      return null;
    case "HALF_GOALS": {
      if (row.htHome == null || row.htAway == null) return null;
      const g1 = row.htHome + row.htAway;
      const g2 = th - g1;
      if (selectionKey === "2h_gt_1h") return g2 > g1 ? 1 : 0;
      if (selectionKey === "1h_gt_2h") return g1 > g2 ? 1 : 0;
      if (selectionKey === "tie") return g1 === g2 ? 1 : 0;
      if (selectionKey === "home_1h_over_0_5") return row.htHome > 0.5 ? 1 : 0;
      if (selectionKey === "away_1h_over_0_5") return row.htAway > 0.5 ? 1 : 0;
      return null;
    }
    case "HT_RESULT": {
      if (row.htHome == null || row.htAway == null) return null;
      const hh = row.htHome;
      const ha = row.htAway;
      if (selectionKey === "ht_home") return hh > ha ? 1 : 0;
      if (selectionKey === "ht_draw") return hh === ha ? 1 : 0;
      if (selectionKey === "ht_away") return ha > hh ? 1 : 0;
      if (selectionKey === "ht_1X") return hh >= ha ? 1 : 0;
      if (selectionKey === "ht_X2") return ha >= hh ? 1 : 0;
      if (selectionKey === "ht_12") return hh !== ha ? 1 : 0;
      return null;
    }
    case "DIEH": {
      if (row.htHome == null || row.htAway == null) return null;
      const d1 = row.htHome === row.htAway;
      const g1h = row.htHome;
      const g1a = row.htAway;
      const g2h = h - g1h;
      const g2a = a - g1a;
      const d2 = g2h === g2a;
      const yes = d1 || d2;
      if (selectionKey === "yes") return yes ? 1 : 0;
      if (selectionKey === "no") return yes ? 0 : 1;
      return null;
    }
    case "CORNERS": {
      if (row.cornersHome == null || row.cornersAway == null) return null;
      const c = row.cornersHome + row.cornersAway;
      if (selectionKey === "over_9_5") return c > 9.5 ? 1 : 0;
      if (selectionKey === "under_9_5") return c < 9.5 ? 1 : 0;
      return null;
    }
    case "COMBO":
      // Approximate common combos from FT scoreline
      if (selectionKey.includes("btts_yes") && selectionKey.includes("home")) {
        return h > a && h >= 1 && a >= 1 ? 1 : 0;
      }
      if (selectionKey === "1x_over_1_5") return h >= a && th > 1.5 ? 1 : 0;
      if (selectionKey === "home_over_1_5") return h > a && th > 1.5 ? 1 : 0;
      if (selectionKey === "btts_no_under_2_5") {
        return (h === 0 || a === 0) && th < 2.5 ? 1 : 0;
      }
      // Fallback: treat as unknown → null (heuristic used)
      return null;
    default:
      return null;
  }
}

export type CooccurrenceStore = {
  series: Map<string, number[]>;
  lookup: RhoLookup;
};

export function buildCooccurrenceFromRows(
  rows: HistOutcomeRow[],
  keys: Array<{ family: MarketFamilyId; selectionKey: string }>
): CooccurrenceStore {
  const series = new Map<string, number[]>();
  for (const k of keys) {
    const key = `${k.family}::${k.selectionKey}`;
    const vec: number[] = [];
    for (const row of rows) {
      const hit = outcomeHit(k.family, k.selectionKey, row);
      if (hit != null) vec.push(hit);
    }
    series.set(key, vec);
  }

  const cache = new Map<string, number>();
  const lookup: RhoLookup = (a, b) => {
    if (a.fixtureId === b.fixtureId) return 0.95;
    const ka = legOutcomeKey(a);
    const kb = legOutcomeKey(b);
    const ck = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    const cached = cache.get(ck);
    if (cached != null) return cached;
    const va = series.get(ka);
    const vb = series.get(kb);
    let r = 0;
    if (va && vb && va.length >= 8 && vb.length >= 8) {
      const n = Math.min(va.length, vb.length);
      r = pearsonRho(va.slice(0, n), vb.slice(0, n));
    } else {
      r = heuristicRho(a, b);
    }
    cache.set(ck, r);
    return r;
  };

  return { series, lookup };
}

export function heuristicLookup(): RhoLookup {
  return heuristicRho;
}

/** Load finished hist fixtures (+ optional corners) for co-occurrence. */
export async function loadHistOutcomeRows(
  competitionNames?: string[]
): Promise<HistOutcomeRow[]> {
  try {
    const db = await getDb();
    const leagueIds =
      competitionNames && competitionNames.length > 0
        ? HIST_LEAGUES.filter((l) => competitionNames.includes(l.name)).map(
            (l) => l.id
          )
        : HIST_LEAGUES.map((l) => l.id);

    const fixtures = await db
      .select({
        fixtureId: schema.histFixtures.fixtureId,
        ftHome: schema.histFixtures.ftHome,
        ftAway: schema.histFixtures.ftAway,
        htHome: schema.histFixtures.htHome,
        htAway: schema.histFixtures.htAway,
        homeId: schema.histFixtures.homeId,
        awayId: schema.histFixtures.awayId,
      })
      .from(schema.histFixtures)
      .where(
        and(
          inArray(schema.histFixtures.leagueId, leagueIds),
          isNotNull(schema.histFixtures.ftHome),
          isNotNull(schema.histFixtures.ftAway),
          eq(schema.histFixtures.status, "FT")
        )
      )
      .limit(8000);

    // Optional corners from hist_stats
    const fixtureIds = fixtures.map((f) => f.fixtureId);
    const cornerMap = new Map<number, { home: number; away: number }>();
    if (fixtureIds.length > 0) {
      const chunk = fixtureIds.slice(0, 4000);
      const stats = await db
        .select({
          fixtureId: schema.histStats.fixtureId,
          teamId: schema.histStats.teamId,
          corners: schema.histStats.corners,
        })
        .from(schema.histStats)
        .where(inArray(schema.histStats.fixtureId, chunk));
      for (const f of fixtures) {
        const home = stats.find(
          (s) => s.fixtureId === f.fixtureId && s.teamId === f.homeId
        );
        const away = stats.find(
          (s) => s.fixtureId === f.fixtureId && s.teamId === f.awayId
        );
        if (home?.corners != null && away?.corners != null) {
          cornerMap.set(f.fixtureId, {
            home: home.corners,
            away: away.corners,
          });
        }
      }
    }

    return fixtures
      .filter((f) => f.ftHome != null && f.ftAway != null)
      .map((f) => {
        const c = cornerMap.get(f.fixtureId);
        return {
          ftHome: f.ftHome!,
          ftAway: f.ftAway!,
          htHome: f.htHome,
          htAway: f.htAway,
          cornersHome: c?.home ?? null,
          cornersAway: c?.away ?? null,
        };
      });
  } catch {
    return [];
  }
}

export async function buildRhoLookup(input: {
  legs: CandidateLeg[];
  competitions?: string[];
}): Promise<RhoLookup> {
  const keys = input.legs.map((l) => ({
    family: l.family,
    selectionKey: l.selectionKey,
  }));
  // Dedupe keys
  const uniq = new Map<string, { family: MarketFamilyId; selectionKey: string }>();
  for (const k of keys) uniq.set(`${k.family}::${k.selectionKey}`, k);
  const rows = await loadHistOutcomeRows(input.competitions);
  if (rows.length < 50) return heuristicLookup();
  return buildCooccurrenceFromRows(rows, [...uniq.values()]).lookup;
}
