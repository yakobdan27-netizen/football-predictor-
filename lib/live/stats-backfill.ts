/**
 * Overnight chunk worker: inventory AF fixtures, then fill match_stats gaps.
 */
import { ensureSchema } from "@/lib/db/init";
import { sleep } from "@/lib/football-api/client";
import {
  discoverStatsApiMatches,
  fetchStatsApiMatch,
  isStatsApiConfigured,
  mapStatsApiIds,
  statsApiCompetitionIdForAfLeague,
} from "@/lib/stats-api";
import {
  STATS_API_STATS_GAP_MS,
} from "./enrich-besoccer";
import { emptyLiveBeSoccerEnrichment } from "./empty-enrichment";
import { isFinishedStatus } from "./normalize";
import { mergeLiveSources } from "./merge-besoccer";
import { apiSportsLiveProvider } from "./provider";
import { applyApiFixtures } from "./sync-apply";
import {
  backfillCellAt,
  STATS_BACKFILL_LEAGUE_IDS,
  STATS_BACKFILL_MAX_STATS_FETCHES,
  STATS_BACKFILL_SEASONS,
  type StatsBackfillPhase,
} from "./stats-backfill-constants";
import {
  countBackfillProgress,
  listFinishedFixturesMissingStats,
  readBackfillCursor,
  writeBackfillCursor,
} from "./stats-backfill-store";
import { recomputeTeamSeasonStats } from "./team-season-stats-recompute";
import type { LiveApiFixture, LiveBeSoccerEnrichment } from "./types";
import { getFixtureById } from "./store";
import type { LiveFixture } from "@/lib/db/schema";

/** Rebuild AF-shaped payload from DB — free plans block `/fixtures?ids=`. */
function liveFixtureToApiShape(
  row: LiveFixture,
  leagueName: string
): LiveApiFixture {
  const kickoff =
    row.kickoffUtc instanceof Date
      ? row.kickoffUtc.toISOString()
      : String(row.kickoffUtc);
  return {
    fixture: {
      id: row.fixtureId,
      date: kickoff,
      status: {
        short: row.status,
        elapsed: row.statusMinute,
      },
      venue: row.venue ? { name: row.venue } : undefined,
    },
    league: {
      id: row.leagueId,
      name: leagueName,
      season: row.season,
    },
    teams: {
      home: { id: row.homeId, name: row.homeTeam },
      away: { id: row.awayId, name: row.awayTeam },
    },
    goals: { home: row.homeGoals, away: row.awayGoals },
  };
}

export type StatsBackfillChunkSummary = {
  ok: boolean;
  phase: StatsBackfillPhase;
  cellIndex: number;
  leagueId: number | null;
  season: number | null;
  leagueName: string | null;
  inventoryFetched: number;
  inventoryUpserted: number;
  statsFetched: number;
  statsMapped: number;
  missingRemaining: number;
  aggregatesTeams: number;
  skippedCell?: boolean;
  done?: boolean;
  truncated?: boolean;
  error?: string;
  warning?: string;
  progress?: {
    inventoryFixtures: number;
    filledWithStats: number;
    missingStats: number;
  };
};

function totalCells(): number {
  return STATS_BACKFILL_LEAGUE_IDS.length * STATS_BACKFILL_SEASONS.length;
}

function dateOnly(iso: string | Date): string | null {
  if (iso instanceof Date) {
    if (Number.isNaN(iso.getTime())) return null;
    return iso.toISOString().slice(0, 10);
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  if (m) return m[1]!;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function advanceToNextCell(
  fromIndex: number,
  summaryNote: string
): Promise<{ cellIndex: number; phase: StatsBackfillPhase; done: boolean }> {
  const next = fromIndex + 1;
  if (next >= totalCells()) {
    await writeBackfillCursor({
      phase: "done",
      cellIndex: fromIndex,
      lastError: null,
      lastSummary: summaryNote,
    });
    return { cellIndex: fromIndex, phase: "done", done: true };
  }
  await writeBackfillCursor({
    phase: "inventory",
    cellIndex: next,
    lastError: null,
    lastSummary: summaryNote,
  });
  return { cellIndex: next, phase: "inventory", done: false };
}

export async function runStatsBackfillChunk(): Promise<StatsBackfillChunkSummary> {
  await ensureSchema();

  let cursor = await readBackfillCursor();
  if (!cursor) {
    cursor = await writeBackfillCursor({
      phase: "inventory",
      cellIndex: 0,
      lastError: null,
      lastSummary: "initialized",
    });
  }

  if (cursor.phase === "done") {
    const progress = await countBackfillProgress().catch(() => undefined);
    return {
      ok: true,
      phase: "done",
      cellIndex: cursor.cellIndex,
      leagueId: cursor.leagueId,
      season: cursor.season,
      leagueName: backfillCellAt(cursor.cellIndex)?.leagueName ?? null,
      inventoryFetched: 0,
      inventoryUpserted: 0,
      statsFetched: 0,
      statsMapped: 0,
      missingRemaining: progress?.missingStats ?? 0,
      aggregatesTeams: 0,
      done: true,
      progress,
      warning: "Backfill already complete for seasons 2021–2025",
    };
  }

  const cell = backfillCellAt(cursor.cellIndex);
  if (!cell) {
    await writeBackfillCursor({
      phase: "done",
      cellIndex: cursor.cellIndex,
      lastError: "Invalid cell index",
      lastSummary: null,
    });
    return {
      ok: false,
      phase: "done",
      cellIndex: cursor.cellIndex,
      leagueId: null,
      season: null,
      leagueName: null,
      inventoryFetched: 0,
      inventoryUpserted: 0,
      statsFetched: 0,
      statsMapped: 0,
      missingRemaining: 0,
      aggregatesTeams: 0,
      done: true,
      error: "Invalid backfill cell index",
    };
  }

  const base = {
    cellIndex: cursor.cellIndex,
    leagueId: cell.leagueId,
    season: cell.season,
    leagueName: cell.leagueName,
  };

  try {
    if (cursor.phase === "inventory") {
      let raw: LiveApiFixture[] = [];
      try {
        raw = await apiSportsLiveProvider.fetchSeasonFixtures(
          cell.leagueId,
          cell.season
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const note = `inventory skipped ${cell.leagueName} ${cell.season}: ${msg}`;
        const advanced = await advanceToNextCell(cursor.cellIndex, note);
        // Preserve error on the advanced cursor
        await writeBackfillCursor({
          phase: advanced.phase,
          cellIndex: advanced.cellIndex,
          lastError: msg,
          lastSummary: note,
        });
        return {
          ok: true,
          phase: advanced.phase,
          cellIndex: advanced.cellIndex,
          leagueId: cell.leagueId,
          season: cell.season,
          leagueName: cell.leagueName,
          inventoryFetched: 0,
          inventoryUpserted: 0,
          statsFetched: 0,
          statsMapped: 0,
          missingRemaining: 0,
          aggregatesTeams: 0,
          skippedCell: true,
          done: advanced.done,
          warning: note,
        };
      }

      const finished = raw.filter((f) =>
        isFinishedStatus((f.fixture?.status?.short ?? "").toUpperCase())
      );

      if (!finished.length) {
        const note = `inventory empty ${cell.leagueName} ${cell.season}`;
        const advanced = await advanceToNextCell(cursor.cellIndex, note);
        return {
          ok: true,
          phase: advanced.phase,
          ...base,
          cellIndex: advanced.cellIndex,
          inventoryFetched: raw.length,
          inventoryUpserted: 0,
          statsFetched: 0,
          statsMapped: 0,
          missingRemaining: 0,
          aggregatesTeams: 0,
          skippedCell: true,
          done: advanced.done,
          warning: note,
        };
      }

      const applied = await applyApiFixtures(finished, cell.season, {
        hydrateEventsOnFt: false,
      });

      await writeBackfillCursor({
        phase: "fill",
        cellIndex: cursor.cellIndex,
        leagueId: cell.leagueId,
        season: cell.season,
        lastError: null,
        lastSummary: `inventory ${cell.leagueName} ${cell.season}: fetched ${raw.length}, finished ${finished.length}, upserted ${applied.upserted}`,
      });

      const progress = await countBackfillProgress({
        leagueId: cell.leagueId,
        season: cell.season,
      });

      return {
        ok: true,
        phase: "fill",
        ...base,
        inventoryFetched: raw.length,
        inventoryUpserted: applied.upserted,
        statsFetched: 0,
        statsMapped: 0,
        missingRemaining: progress.missingStats,
        aggregatesTeams: 0,
        progress,
      };
    }

    // phase === "fill"
    if (!isStatsApiConfigured()) {
      const msg = "STATS_API_KEY not configured — cannot fill match_stats";
      await writeBackfillCursor({
        phase: "fill",
        cellIndex: cursor.cellIndex,
        leagueId: cell.leagueId,
        season: cell.season,
        lastError: msg,
        lastSummary: cursor.lastSummary,
      });
      return {
        ok: false,
        phase: "fill",
        ...base,
        inventoryFetched: 0,
        inventoryUpserted: 0,
        statsFetched: 0,
        statsMapped: 0,
        missingRemaining: 0,
        aggregatesTeams: 0,
        error: msg,
      };
    }

    const missing = await listFinishedFixturesMissingStats({
      leagueId: cell.leagueId,
      season: cell.season,
      limit: STATS_BACKFILL_MAX_STATS_FETCHES,
    });

    if (!missing.length) {
      const agg = await recomputeTeamSeasonStats(cell.leagueId, cell.season);
      const note = `fill complete ${cell.leagueName} ${cell.season}; aggregates ${agg.teams} teams`;
      const advanced = await advanceToNextCell(cursor.cellIndex, note);
      const progress = await countBackfillProgress().catch(() => undefined);
      return {
        ok: true,
        phase: advanced.phase,
        ...base,
        cellIndex: advanced.cellIndex,
        inventoryFetched: 0,
        inventoryUpserted: 0,
        statsFetched: 0,
        statsMapped: 0,
        missingRemaining: 0,
        aggregatesTeams: agg.teams,
        done: advanced.done,
        progress,
      };
    }

    const competitionId = statsApiCompetitionIdForAfLeague(cell.leagueId);
    const competitionIds = competitionId ? [competitionId] : [];

    const identities = await Promise.all(
      missing.map(async (f) => {
        let cached: string | null = f.besoccerMatchId ?? null;
        if (!cached) {
          try {
            cached = (await getFixtureById(f.fixtureId))?.besoccerMatchId ?? null;
          } catch {
            cached = null;
          }
        }
        return {
          fixtureId: f.fixtureId,
          homeTeam: f.homeTeam,
          awayTeam: f.awayTeam,
          kickoffUtc:
            f.kickoffUtc instanceof Date
              ? f.kickoffUtc.toISOString()
              : String(f.kickoffUtc),
          statsApiMatchId: cached,
        };
      })
    );

    // Discover per unique match-day only — season-wide ranges hang / blow pages.
    const uniqueDates = [
      ...new Set(
        identities
          .map((i) => dateOnly(i.kickoffUtc))
          .filter((d): d is string => !!d)
      ),
    ].sort();
    console.log(
      `[stats-backfill] fill ${cell.leagueName} ${cell.season}: ${missing.length} gaps, ${uniqueDates.length} days to discover`
    );

    const dayMatches = [];
    for (const day of uniqueDates) {
      const listed = await discoverStatsApiMatches({
        dateFrom: day,
        dateTo: day,
        competitionIds,
        maxPages: 3,
      });
      dayMatches.push(...listed);
      await sleep(250);
    }
    console.log(
      `[stats-backfill] discovered ${dayMatches.length} Stats matches across ${uniqueDates.length} days`
    );
    const idMap = mapStatsApiIds(identities, dayMatches);
    console.log(`[stats-backfill] mapped ${idMap.size}/${missing.length} fixture ids`);

    // Free AF plans reject `/fixtures?ids=` — synthesize from live_fixtures.
    const byId = new Map(
      missing.map((m) => [m.fixtureId, liveFixtureToApiShape(m, cell.leagueName)])
    );

    let fetched = 0;
    let truncated = false;
    let upserted = 0;

    for (const row of missing) {
      const af = byId.get(row.fixtureId);
      if (!af) continue;
      const statsId = idMap.get(row.fixtureId) ?? null;
      let enrichment: LiveBeSoccerEnrichment | null = null;
      let fx: LiveApiFixture = af;

      if (statsId == null) {
        continue;
      }
      if (fetched >= STATS_BACKFILL_MAX_STATS_FETCHES) {
        truncated = true;
        break;
      }

      try {
        const match = await fetchStatsApiMatch(statsId);
        fetched += 1;
        if (match) {
          const merged = mergeLiveSources(af, match, statsId);
          fx = merged.fixture;
          enrichment = merged.enrichment;
        } else {
          enrichment = emptyLiveBeSoccerEnrichment(statsId);
        }
      } catch (e) {
        console.warn(
          "[stats-backfill] /stats failed",
          statsId,
          e instanceof Error ? e.message : e
        );
        enrichment = emptyLiveBeSoccerEnrichment(statsId);
        fetched += 1;
      }

      let appliedOk = false;
      for (let attempt = 0; attempt < 3 && !appliedOk; attempt++) {
        try {
          const applied = await applyApiFixtures([fx], cell.season, {
            beSoccerEnrichments: enrichment
              ? new Map([[row.fixtureId, enrichment]])
              : undefined,
            hydrateEventsOnFt: false,
          });
          upserted += applied.matchStatsUpserted || applied.upserted;
          appliedOk = true;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(
            `[stats-backfill] upsert retry ${attempt + 1}/3`,
            row.fixtureId,
            msg
          );
          await sleep(1500 * (attempt + 1));
          if (attempt === 2) {
            console.warn("[stats-backfill] upsert gave up", row.fixtureId);
          }
        }
      }
      await sleep(STATS_API_STATS_GAP_MS);
    }

    const stillMissing = await listFinishedFixturesMissingStats({
      leagueId: cell.leagueId,
      season: cell.season,
      limit: 1,
    });

    let aggregatesTeams = 0;
    let phase: StatsBackfillPhase = "fill";
    let nextIndex = cursor.cellIndex;
    let done = false;

    if (!stillMissing.length) {
      const agg = await recomputeTeamSeasonStats(cell.leagueId, cell.season);
      aggregatesTeams = agg.teams;
      const note = `fill complete ${cell.leagueName} ${cell.season}; fetched ${fetched}; aggregates ${agg.teams}`;
      const advanced = await advanceToNextCell(cursor.cellIndex, note);
      phase = advanced.phase;
      nextIndex = advanced.cellIndex;
      done = advanced.done;
    } else {
      await writeBackfillCursor({
        phase: "fill",
        cellIndex: cursor.cellIndex,
        leagueId: cell.leagueId,
        season: cell.season,
        lastError: null,
        lastSummary: `fill ${cell.leagueName} ${cell.season}: fetched ${fetched}, upserted ${upserted}, remaining gaps`,
      });
    }

    // Refresh aggregates incrementally even mid-fill so priors update early
    if (fetched > 0 && stillMissing.length) {
      const agg = await recomputeTeamSeasonStats(cell.leagueId, cell.season);
      aggregatesTeams = agg.teams;
    }

    const progress = await countBackfillProgress({
      leagueId: cell.leagueId,
      season: cell.season,
    });

    return {
      ok: true,
      phase,
      cellIndex: nextIndex,
      leagueId: cell.leagueId,
      season: cell.season,
      leagueName: cell.leagueName,
      inventoryFetched: 0,
      inventoryUpserted: 0,
      statsFetched: fetched,
      statsMapped: idMap.size,
      missingRemaining: progress.missingStats,
      aggregatesTeams,
      truncated,
      done,
      progress,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const transient =
      /fetch failed|Connect Timeout|UND_ERR|NeonDbError|Error connecting/i.test(
        msg
      );
    await writeBackfillCursor({
      phase: cursor.phase,
      cellIndex: cursor.cellIndex,
      leagueId: cell.leagueId,
      season: cell.season,
      lastError: msg,
      lastSummary: cursor.lastSummary,
    }).catch(() => undefined);
    return {
      ok: transient,
      phase: cursor.phase,
      ...base,
      inventoryFetched: 0,
      inventoryUpserted: 0,
      statsFetched: 0,
      statsMapped: 0,
      missingRemaining: 0,
      aggregatesTeams: 0,
      error: msg,
      warning: transient
        ? "Transient DB/network error — cron will retry next run"
        : undefined,
    };
  }
}
