import {
  discoverStatsApiMatches,
  fetchStatsApiMatch,
  isStatsApiConfigured,
  mapStatsApiIds,
  statsApiCompetitionIdsForAfLeagues,
  statsApiDefaultDateRange,
  STATS_API_PL_COMPETITION_ID,
} from "@/lib/stats-api";
import { sleep } from "@/lib/football-api/client";
import { getFixtureById } from "./store";
import { mergeLiveSources } from "./merge-besoccer";
import { emptyLiveBeSoccerEnrichment } from "./empty-enrichment";
import type { LiveApiFixture, LiveBeSoccerEnrichment } from "./types";

export type BeSoccerEnrichmentMap = Map<number, LiveBeSoccerEnrichment>;

/**
 * Cap per-run Stats API `/stats` calls.
 * There is no bulk stats endpoint; at ~12 req/min a high cap will timeout.
 */
export const STATS_API_MAX_STATS_FETCHES = 20;

/** Pace `/stats` calls (~12 req/min ⇒ ~5s). */
export const STATS_API_STATS_GAP_MS = 5_200;

function dateOnly(iso: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  if (m) return m[1]!;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Enrich API-Football fixtures with The Stats API match statistics.
 * Discovers provider match ids across the fixtures' date span (competition-scoped),
 * or an explicit discover range when provided (e.g. free-plan test year 2023).
 */
export async function enrichFixturesWithBeSoccer(
  raw: LiveApiFixture[],
  opts?: {
    maxStatsFetches?: number;
    discoverFrom?: string;
    discoverTo?: string;
    /** Override Stats API competition filter (defaults from AF league ids). */
    competitionIds?: string[];
  }
): Promise<{
  fixtures: LiveApiFixture[];
  enrichments: BeSoccerEnrichmentMap;
  mapped: number;
  fetched: number;
  skippedSeason: number;
  discoverFrom: string | null;
  discoverTo: string | null;
  discoverCount: number;
  truncated: boolean;
}> {
  const enrichments: BeSoccerEnrichmentMap = new Map();
  const maxStats = opts?.maxStatsFetches ?? STATS_API_MAX_STATS_FETCHES;

  if (!raw.length || !isStatsApiConfigured()) {
    return {
      fixtures: raw,
      enrichments,
      mapped: 0,
      fetched: 0,
      skippedSeason: 0,
      discoverFrom: null,
      discoverTo: null,
      discoverCount: 0,
      truncated: false,
    };
  }

  const identities = await Promise.all(
    raw.map(async (f) => {
      const id = f.fixture.id;
      let cached: string | null = null;
      try {
        const row = await getFixtureById(id);
        cached = row?.besoccerMatchId ?? null;
      } catch {
        cached = null;
      }
      return {
        fixtureId: id,
        homeTeam: f.teams.home.name,
        awayTeam: f.teams.away.name,
        kickoffUtc: f.fixture.date,
        statsApiMatchId: cached,
        leagueId: f.league?.id ?? null,
      };
    })
  );

  const needDiscover = identities.some((i) => !i.statsApiMatchId);
  let discoverFrom: string;
  let discoverTo: string;

  if (opts?.discoverFrom && opts?.discoverTo) {
    discoverFrom = opts.discoverFrom;
    discoverTo = opts.discoverTo;
  } else {
    const dates = identities
      .map((i) => dateOnly(i.kickoffUtc))
      .filter((d): d is string => !!d)
      .sort();
    if (dates.length) {
      discoverFrom = dates[0]!;
      discoverTo = dates[dates.length - 1]!;
    } else {
      const defaults = statsApiDefaultDateRange();
      discoverFrom = defaults.dateFrom;
      discoverTo = defaults.dateTo;
    }
  }

  const fromFixtures = statsApiCompetitionIdsForAfLeagues(
    identities
      .map((i) => i.leagueId)
      .filter((id): id is number => id != null)
  );
  const competitionIds =
    opts?.competitionIds?.length
      ? opts.competitionIds
      : fromFixtures.length
        ? fromFixtures
        : [STATS_API_PL_COMPETITION_ID];

  const dayMatches = needDiscover
    ? await discoverStatsApiMatches({
        dateFrom: discoverFrom,
        dateTo: discoverTo,
        competitionIds,
      })
    : [];
  const idMap = mapStatsApiIds(identities, dayMatches);

  const fixtures: LiveApiFixture[] = [];
  let fetched = 0;
  let truncated = false;

  for (const f of raw) {
    const statsId = idMap.get(f.fixture.id) ?? null;

    if (statsId == null) {
      fixtures.push(f);
      continue;
    }

    if (fetched >= maxStats) {
      truncated = true;
      fixtures.push(f);
      enrichments.set(f.fixture.id, emptyLiveBeSoccerEnrichment(statsId));
      continue;
    }

    try {
      const match = await fetchStatsApiMatch(statsId);
      fetched += 1;
      if (match) {
        const merged = mergeLiveSources(f, match, statsId);
        fixtures.push(merged.fixture);
        enrichments.set(f.fixture.id, merged.enrichment);
      } else {
        fixtures.push(f);
        enrichments.set(f.fixture.id, emptyLiveBeSoccerEnrichment(statsId));
      }
    } catch (e) {
      console.warn(
        "[stats-api] match stats failed for",
        statsId,
        e instanceof Error ? e.message : e
      );
      fixtures.push(f);
      enrichments.set(f.fixture.id, emptyLiveBeSoccerEnrichment(statsId));
    }

    await sleep(STATS_API_STATS_GAP_MS);
  }

  return {
    fixtures,
    enrichments,
    mapped: idMap.size,
    fetched,
    skippedSeason: 0,
    discoverFrom: needDiscover ? discoverFrom : null,
    discoverTo: needDiscover ? discoverTo : null,
    discoverCount: dayMatches.length,
    truncated,
  };
}
