/**
 * Aggregated hist inventory + DIEH readiness for dashboard / status surfaces.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  histMeta,
  teamHalfStats,
  teamRatings,
  teamSeasonStats,
} from "@/lib/db/schema";
import { sqlCount } from "@/lib/core/sql-count";
import {
  auditHistCoverage,
  enrichmentGapQueueFromCoverage,
  gapQueueFromCoverage,
  type HistCoverageReport,
} from "./coverage-audit";
import {
  cronInterleaveEnrichmentFromEnv,
  cronMaxChunksFromEnv,
  HIST_CRON_DEADLINE_MS_DEFAULT,
} from "./daily-drain";
import {
  DIEH_MIN_VALID_FIXTURES,
  type HalfParamsStore,
} from "./half-params-types";
import { loadHalfParamsStore } from "./half-params";
import { resolveHistSyncTier, type HistSyncMode } from "./preflight";
import { HIST_LEAGUES } from "./seasons";

export type DiehLeagueStatus = {
  leagueName: string;
  compType: "league" | "cup";
  nValid: number;
  diehReady: boolean;
  s1: number;
  kappaAdj: number;
  goalsDistribution: string;
  computedAt: string | null;
};

export type DerivedLeagueCounts = {
  leagueId: number;
  leagueName: string;
  teamHalfStats: number;
  teamRatings: number;
  teamSeasonStats: number;
  htMissingPct: number | null;
  cornersMissingPct: number | null;
};

export type SystemInformation = {
  generatedAt: string;
  hist: HistCoverageReport["summary"] & {
    gatePass: boolean;
    perCompetition: HistCoverageReport["perCompetition"];
  };
  dieh: {
    fittedAt: string | null;
    minValid: number;
    leagues: DiehLeagueStatus[];
    readyCount: number;
  };
  derived: {
    histFixturesTotal: number;
    coreFixturesTotal: number;
    syncMode: HistSyncMode;
    perLeague: DerivedLeagueCounts[];
  };
  meta: {
    lastRunAt: string | null;
    lastSummary: string | null;
    apiPlan: string | null;
    apiRemaining: number | null;
    syncMode: HistSyncMode;
  };
  drain: {
    gapsRemaining: number;
    enrichmentGapsRemaining: number;
    totalStored: number;
    mode: "gap-priority" | "enrichment";
    scheduleUtc: string[];
    scheduleNote: string;
  };
};

async function loadDerivedLeagueCounts(
  perCompetition: HistCoverageReport["perCompetition"]
): Promise<DerivedLeagueCounts[]> {
  const db = await getDb();
  const halfRows = await db
    .select({
      leagueId: teamHalfStats.leagueId,
      n: sql<number>`count(*)::int`,
    })
    .from(teamHalfStats)
    .groupBy(teamHalfStats.leagueId);
  const ratingRows = await db
    .select({
      leagueId: teamRatings.leagueId,
      n: sql<number>`count(*)::int`,
    })
    .from(teamRatings)
    .groupBy(teamRatings.leagueId);
  const seasonRows = await db
    .select({
      leagueId: teamSeasonStats.leagueId,
      n: sql<number>`count(*)::int`,
    })
    .from(teamSeasonStats)
    .groupBy(teamSeasonStats.leagueId);

  const halfMap = new Map(halfRows.map((r) => [r.leagueId, Number(r.n)]));
  const ratingMap = new Map(ratingRows.map((r) => [r.leagueId, Number(r.n)]));
  const seasonMap = new Map(seasonRows.map((r) => [r.leagueId, Number(r.n)]));
  const compMap = new Map(
    perCompetition.map((c) => [c.leagueId, c] as const)
  );

  return HIST_LEAGUES.map((league) => {
    const comp = compMap.get(league.id);
    const stored = comp?.stored ?? 0;
    const withHt = comp?.withHt ?? 0;
    const withCorners = comp?.withCorners ?? 0;
    return {
      leagueId: league.id,
      leagueName: league.name,
      teamHalfStats: halfMap.get(league.id) ?? 0,
      teamRatings: ratingMap.get(league.id) ?? 0,
      teamSeasonStats: seasonMap.get(league.id) ?? 0,
      htMissingPct:
        stored > 0 ? Math.round((1 - withHt / stored) * 1000) / 10 : null,
      cornersMissingPct:
        stored > 0
          ? Math.round((1 - withCorners / stored) * 1000) / 10
          : null,
    };
  });
}

export async function buildSystemInformation(): Promise<SystemInformation> {
  const coverage = await auditHistCoverage();
  const halfStore = await loadHalfParamsStore();

  let metaRow: {
    lastRunAt: Date | null;
    lastSummary: string | null;
    plan: string | null;
    remaining: number | null;
  } | null = null;
  try {
    const db = await getDb();
    const [row] = await db
      .select({
        lastRunAt: histMeta.lastRunAt,
        lastSummary: histMeta.lastSummary,
        plan: histMeta.plan,
        remaining: histMeta.remaining,
      })
      .from(histMeta)
      .where(eq(histMeta.id, 1))
      .limit(1);
    metaRow = row ?? null;
  } catch {
    metaRow = null;
  }

  const diehLeagues: DiehLeagueStatus[] = halfStore.leagues.map((l) => ({
    leagueName: l.leagueName,
    compType: l.compType,
    nValid: l.nValid,
    diehReady: l.nValid >= DIEH_MIN_VALID_FIXTURES,
    s1: l.s1,
    kappaAdj: l.kappaAdj,
    goalsDistribution: l.goalsDistribution,
    computedAt: l.computedAt,
  }));

  const inv = coverage.summary.inventoryPass;
  const gatePass = inv >= coverage.summary.total;
  const gapsRemaining = gapQueueFromCoverage(coverage).length;
  const enrichmentGapsRemaining =
    enrichmentGapQueueFromCoverage(coverage).length;
  const totalStored = coverage.perCompetition.reduce((n, c) => n + c.stored, 0);
  const drainMode =
    gatePass && enrichmentGapsRemaining > 0 ? "enrichment" : "gap-priority";
  const maxChunks = cronMaxChunksFromEnv();
  const interleave = cronInterleaveEnrichmentFromEnv();
  const syncTier = resolveHistSyncTier(metaRow?.remaining ?? null, true);

  let histFixturesTotal = 0;
  let coreFixturesTotal = 0;
  let perLeague: DerivedLeagueCounts[] = [];
  try {
    const db = await getDb();
    histFixturesTotal = await sqlCount(
      db,
      "SELECT count(*)::int AS c FROM hist_fixtures"
    );
    coreFixturesTotal = await sqlCount(
      db,
      "SELECT count(*)::int AS c FROM core_fixture"
    );
    perLeague = await loadDerivedLeagueCounts(coverage.perCompetition);
  } catch {
    perLeague = [];
  }

  const gateTotal = coverage.summary.total;

  return {
    generatedAt: new Date().toISOString(),
    hist: {
      ...coverage.summary,
      gatePass,
      perCompetition: coverage.perCompetition,
    },
    dieh: {
      fittedAt: halfStore.fittedAt || null,
      minValid: DIEH_MIN_VALID_FIXTURES,
      leagues: diehLeagues,
      readyCount: diehLeagues.filter((l) => l.diehReady).length,
    },
    derived: {
      histFixturesTotal,
      coreFixturesTotal,
      syncMode: syncTier.syncMode,
      perLeague,
    },
    meta: {
      lastRunAt: metaRow?.lastRunAt?.toISOString() ?? null,
      lastSummary: metaRow?.lastSummary ?? null,
      apiPlan: metaRow?.plan ?? null,
      apiRemaining: metaRow?.remaining ?? null,
      syncMode: syncTier.syncMode,
    },
    drain: {
      gapsRemaining,
      enrichmentGapsRemaining,
      totalStored,
      mode: drainMode,
      scheduleUtc: ["04:00", "05:00", "06:00", "09:00"],
      scheduleNote:
        gatePass && enrichmentGapsRemaining > 0
          ? `Cron /api/cron/hist-backfill · enrichment phase · ${enrichmentGapsRemaining} HT/corners gaps · sync=${syncTier.syncMode}`
          : interleave
            ? `Cron hist 05:00 + core 06:00 · gap-priority until ${gateTotal}/${gateTotal} · ≤${maxChunks} chunks · sync=${syncTier.syncMode}`
            : `Cron hist 05:00 + core 06:00 · gap-priority until ${gateTotal}/${gateTotal} · ≤${maxChunks} chunks`,
    },
  };
}

export function halfParamsFromStore(store: HalfParamsStore): SystemInformation["dieh"] {
  const diehLeagues: DiehLeagueStatus[] = store.leagues.map((l) => ({
    leagueName: l.leagueName,
    compType: l.compType,
    nValid: l.nValid,
    diehReady: l.nValid >= DIEH_MIN_VALID_FIXTURES,
    s1: l.s1,
    kappaAdj: l.kappaAdj,
    goalsDistribution: l.goalsDistribution,
    computedAt: l.computedAt,
  }));
  return {
    fittedAt: store.fittedAt || null,
    minValid: DIEH_MIN_VALID_FIXTURES,
    leagues: diehLeagues,
    readyCount: diehLeagues.filter((l) => l.diehReady).length,
  };
}
