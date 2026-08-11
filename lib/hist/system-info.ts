/**
 * Aggregated hist inventory + DIEH readiness for dashboard / status surfaces.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { histMeta } from "@/lib/db/schema";
import {
  auditHistCoverage,
  gapQueueFromCoverage,
  type HistCoverageReport,
} from "./coverage-audit";
import {
  DIEH_MIN_VALID_FIXTURES,
  type HalfParamsStore,
} from "./half-params-types";
import { loadHalfParamsStore } from "./half-params";

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
  meta: {
    lastRunAt: string | null;
    lastSummary: string | null;
    apiPlan: string | null;
    apiRemaining: number | null;
  };
  drain: {
    gapsRemaining: number;
    totalStored: number;
    mode: "gap-priority";
    scheduleUtc: string[];
    scheduleNote: string;
  };
};

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
  const totalStored = coverage.perCompetition.reduce((n, c) => n + c.stored, 0);

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
    meta: {
      lastRunAt: metaRow?.lastRunAt?.toISOString() ?? null,
      lastSummary: metaRow?.lastSummary ?? null,
      apiPlan: metaRow?.plan ?? null,
      apiRemaining: metaRow?.remaining ?? null,
    },
    drain: {
      gapsRemaining,
      totalStored,
      mode: "gap-priority",
      scheduleUtc: ["05:00", "09:00", "13:00", "17:00", "21:00"],
      scheduleNote:
        "Cron /api/cron/hist-backfill · gap-priority · stops at inventoryPass=66 or quota",
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
