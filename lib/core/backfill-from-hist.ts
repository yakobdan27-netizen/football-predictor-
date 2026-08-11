/**
 * Non-destructive hist_* → core_* backfill.
 * Idempotent upserts; never coerce NULL→0; never overwrite manual_verified.
 */
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  coreCompetition,
  coreCoverageAudit,
  coreFixture,
  coreFixtureStatistic,
  coreLegacyRecordMap,
  coreSeason,
  coreTeam,
  coreTeamAlias,
  histFixtures,
  histStats,
  histTeams,
} from "@/lib/db/schema";
import { TEAM_ALIASES } from "@/lib/data/team-names";
import { normalizeAlias } from "@/lib/core/alias";
import { preserveNullableStat } from "@/lib/core/stats";
import { seedCompetitionsAndSeasons } from "@/lib/core/seed-competitions";
import { auditHistCoverage } from "@/lib/hist/coverage-audit";
import { bridgePendingBatchesFromKv } from "@/lib/core/result-trace-bridge";
import { sqlCount } from "@/lib/core/sql-count";

export type BackfillOptions = {
  dryRun?: boolean;
  /** Max fixtures to process (0 = all). */
  limit?: number;
  skipKvTraces?: boolean;
};

export type BackfillReport = {
  dryRun: boolean;
  competitionsUpserted: number;
  seasonsUpserted: number;
  teamsUpserted: number;
  aliasesUpserted: number;
  fixturesUpserted: number;
  fixturesSkippedManual: number;
  statsUpserted: number;
  mapsUpserted: number;
  coverageBuckets: number;
  kvTraces: { considered: number; wouldWrite: number; wrote: number };
  errors: string[];
};

async function loadCompetitionSeasonMaps(): Promise<{
  competitionByProviderId: Map<number, number>;
  seasonByCompAndYear: Map<string, number>;
}> {
  const db = await getDb();
  const comps = await db.select().from(coreCompetition);
  const seasons = await db.select().from(coreSeason);
  const competitionByProviderId = new Map(
    comps.map((c) => [c.providerCompetitionId, c.id] as const)
  );
  const seasonByCompAndYear = new Map(
    seasons.map((s) => [`${s.competitionId}:${s.providerSeason}`, s.id] as const)
  );
  return { competitionByProviderId, seasonByCompAndYear };
}

async function upsertTeam(
  row: {
    providerTeamId: number;
    canonicalName: string;
    country: string | null;
    logoUrl: string | null;
  },
  dryRun: boolean,
  now: Date
): Promise<number | null> {
  const db = await getDb();
  const existing = await db
    .select()
    .from(coreTeam)
    .where(
      and(
        eq(coreTeam.providerName, "api-sports"),
        eq(coreTeam.providerTeamId, row.providerTeamId)
      )
    )
    .limit(1);
  if (existing[0]) {
    if (!dryRun) {
      await db
        .update(coreTeam)
        .set({
          canonicalName: row.canonicalName,
          country: row.country,
          logoUrl: row.logoUrl,
          updatedAt: now,
        })
        .where(eq(coreTeam.id, existing[0].id));
    }
    return existing[0].id;
  }
  if (dryRun) return -row.providerTeamId;
  const inserted = await db
    .insert(coreTeam)
    .values({
      providerName: "api-sports",
      providerTeamId: row.providerTeamId,
      canonicalName: row.canonicalName,
      country: row.country,
      logoUrl: row.logoUrl,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: coreTeam.id });
  return inserted[0]!.id;
}

async function upsertAlias(
  teamId: number,
  aliasRaw: string,
  source: string,
  approved: boolean,
  dryRun: boolean,
  now: Date
): Promise<boolean> {
  if (teamId < 0) return true;
  const aliasNormalized = normalizeAlias(aliasRaw);
  if (!aliasNormalized) return false;
  const db = await getDb();
  const existing = await db
    .select()
    .from(coreTeamAlias)
    .where(
      and(
        eq(coreTeamAlias.aliasNormalized, aliasNormalized),
        eq(coreTeamAlias.teamId, teamId)
      )
    )
    .limit(1);
  if (existing[0]) {
    if (!dryRun && approved && existing[0].approved !== 1) {
      await db
        .update(coreTeamAlias)
        .set({ approved: 1, source })
        .where(eq(coreTeamAlias.id, existing[0].id));
    }
    return true;
  }
  if (dryRun) return true;
  await db.insert(coreTeamAlias).values({
    teamId,
    aliasNormalized,
    aliasRaw,
    source,
    approved: approved ? 1 : 0,
    createdAt: now,
  });
  return true;
}

async function upsertStat(
  fixtureId: number,
  side: "home" | "away",
  teamId: number | null,
  statKey: string,
  statValue: number | null,
  sourceUpdatedAt: Date,
  dryRun: boolean
): Promise<boolean> {
  if (fixtureId < 0) return true;
  const db = await getDb();
  const existing = await db
    .select()
    .from(coreFixtureStatistic)
    .where(
      and(
        eq(coreFixtureStatistic.fixtureId, fixtureId),
        eq(coreFixtureStatistic.side, side),
        eq(coreFixtureStatistic.statKey, statKey)
      )
    )
    .limit(1);
  if (existing[0]?.manualVerified === 1) return false;
  if (existing[0]) {
    const prev = existing[0].sourceUpdatedAt;
    if (prev && prev.getTime() >= sourceUpdatedAt.getTime()) return false;
    if (!dryRun) {
      await db
        .update(coreFixtureStatistic)
        .set({
          teamId,
          statValue,
          sourceUpdatedAt,
        })
        .where(eq(coreFixtureStatistic.id, existing[0].id));
    }
    return true;
  }
  if (dryRun) return true;
  await db.insert(coreFixtureStatistic).values({
    fixtureId,
    teamId,
    side,
    statKey,
    statValue,
    manualVerified: 0,
    sourceUpdatedAt,
  });
  return true;
}

/**
 * Backfill competitions, teams, aliases, fixtures, stats, coverage, KV pending traces.
 */
export async function backfillFromHist(
  opts: BackfillOptions = {}
): Promise<BackfillReport> {
  const dryRun = opts.dryRun === true;
  const limit = opts.limit ?? 0;
  const errors: string[] = [];
  const now = new Date();

  const seed = await seedCompetitionsAndSeasons({ dryRun });
  const maps = dryRun
    ? {
        competitionByProviderId: seed.competitionIds,
        seasonByCompAndYear: seed.seasonIds,
      }
    : await loadCompetitionSeasonMaps();

  const db = await getDb();
  let teamsUpserted = 0;
  let aliasesUpserted = 0;
  let fixturesUpserted = 0;
  let fixturesSkippedManual = 0;
  let statsUpserted = 0;
  let mapsUpserted = 0;

  const teamIdByProvider = new Map<number, number>();

  // Teams
  const histTeamRows = await db.select().from(histTeams);
  for (const t of histTeamRows) {
    try {
      const id = await upsertTeam(
        {
          providerTeamId: t.teamId,
          canonicalName: t.name,
          country: t.country,
          logoUrl: t.logo,
        },
        dryRun,
        now
      );
      if (id != null) {
        teamIdByProvider.set(t.teamId, id);
        teamsUpserted++;
        // Canonical self-alias approved
        if (
          await upsertAlias(
            id,
            t.name,
            "hist_teams",
            true,
            dryRun,
            now
          )
        ) {
          aliasesUpserted++;
        }
      }
    } catch (e) {
      errors.push(
        `team ${t.teamId}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  // Approved aliases from TEAM_ALIASES → resolve by canonical name match
  const nameToTeamId = new Map<string, number>();
  for (const t of histTeamRows) {
    const id = teamIdByProvider.get(t.teamId);
    if (id != null) nameToTeamId.set(normalizeAlias(t.name), id);
  }
  for (const [alias, canonical] of Object.entries(TEAM_ALIASES)) {
    const teamId = nameToTeamId.get(normalizeAlias(canonical));
    if (teamId == null) continue;
    try {
      if (
        await upsertAlias(
          teamId,
          alias,
          "team-names.ts",
          true,
          dryRun,
          now
        )
      ) {
        aliasesUpserted++;
      }
    } catch (e) {
      errors.push(
        `alias ${alias}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  // Fixtures
  const allFixtures = await db
    .select()
    .from(histFixtures)
    .orderBy(asc(histFixtures.fixtureId));
  const slice = limit > 0 ? allFixtures.slice(0, limit) : allFixtures;

  for (const f of slice) {
    try {
      const competitionId =
        maps.competitionByProviderId.get(f.leagueId) ?? null;
      const seasonId =
        competitionId != null
          ? maps.seasonByCompAndYear.get(`${competitionId}:${f.season}`) ?? null
          : null;
      const homeTeamId =
        f.homeId != null ? teamIdByProvider.get(f.homeId) ?? null : null;
      const awayTeamId =
        f.awayId != null ? teamIdByProvider.get(f.awayId) ?? null : null;
      const sourceUpdatedAt = f.importedAt ?? now;

      const existing = await db
        .select()
        .from(coreFixture)
        .where(
          and(
            eq(coreFixture.providerName, "api-sports"),
            eq(coreFixture.providerFixtureId, f.fixtureId)
          )
        )
        .limit(1);

      let coreId: number;
      if (existing[0]?.manualVerified === 1) {
        fixturesSkippedManual++;
        coreId = existing[0].id;
      } else if (existing[0]) {
        const prev = existing[0].sourceUpdatedAt;
        const newer =
          !prev || sourceUpdatedAt.getTime() >= prev.getTime();
        if (newer && !dryRun) {
          await db
            .update(coreFixture)
            .set({
              competitionId,
              seasonId,
              homeTeamId,
              awayTeamId,
              homeTeamName: f.homeTeam,
              awayTeamName: f.awayTeam,
              kickoffUtc: f.dateUtc,
              status: f.status,
              htHome: f.htHome,
              htAway: f.htAway,
              ftHome: f.ftHome,
              ftAway: f.ftAway,
              venue: f.venue,
              round: f.round,
              sourceUpdatedAt,
            })
            .where(eq(coreFixture.id, existing[0].id));
        }
        coreId = existing[0].id;
        if (newer) fixturesUpserted++;
      } else if (dryRun) {
        coreId = -f.fixtureId;
        fixturesUpserted++;
      } else {
        const inserted = await db
          .insert(coreFixture)
          .values({
            providerName: "api-sports",
            providerFixtureId: f.fixtureId,
            competitionId,
            seasonId,
            homeTeamId,
            awayTeamId,
            homeTeamName: f.homeTeam,
            awayTeamName: f.awayTeam,
            kickoffUtc: f.dateUtc,
            status: f.status,
            htHome: f.htHome,
            htAway: f.htAway,
            ftHome: f.ftHome,
            ftAway: f.ftAway,
            venue: f.venue,
            round: f.round,
            manualVerified: 0,
            sourceUpdatedAt,
            importedAt: now,
          })
          .returning({ id: coreFixture.id });
        coreId = inserted[0]!.id;
        fixturesUpserted++;
      }

      // Legacy map
      if (coreId > 0) {
        const mapExisting = await db
          .select()
          .from(coreLegacyRecordMap)
          .where(
            and(
              eq(coreLegacyRecordMap.legacySourceTable, "hist_fixtures"),
              eq(coreLegacyRecordMap.legacyPk, String(f.fixtureId))
            )
          )
          .limit(1);
        if (!mapExisting[0] && !dryRun) {
          await db.insert(coreLegacyRecordMap).values({
            legacySourceTable: "hist_fixtures",
            legacyPk: String(f.fixtureId),
            canonicalEntityType: "fixture",
            canonicalEntityId: coreId,
            verified: 1,
            createdAt: now,
          });
          mapsUpserted++;
        } else if (!mapExisting[0] && dryRun) {
          mapsUpserted++;
        } else if (mapExisting[0]) {
          mapsUpserted++;
        }
      } else if (dryRun) {
        mapsUpserted++;
      }

      // Stats from hist_stats (per team) + never NULL→0
      const stats = await db
        .select()
        .from(histStats)
        .where(eq(histStats.fixtureId, f.fixtureId));
      for (const s of stats) {
        const side: "home" | "away" | null =
          f.homeId != null && s.teamId === f.homeId
            ? "home"
            : f.awayId != null && s.teamId === f.awayId
              ? "away"
              : null;
        if (!side) continue;
        const teamCoreId = teamIdByProvider.get(s.teamId) ?? null;
        const pairs: Array<[string, number | null]> = [
          ["shots", preserveNullableStat(s.shots)],
          ["sot", preserveNullableStat(s.sot)],
          ["possession", preserveNullableStat(s.possession)],
          ["corners", preserveNullableStat(s.corners)],
          ["ht_corners", preserveNullableStat(s.htCorners)],
          ["yellow", preserveNullableStat(s.yellow)],
          ["red", preserveNullableStat(s.red)],
          ["fouls", preserveNullableStat(s.fouls)],
          ["offsides", preserveNullableStat(s.offsides)],
        ];
        for (const [key, val] of pairs) {
          // Skip entirely-null rows? Still store NULL to record "known missing"?
          // Plan: copy known stats; NULL ≠ 0 — store when hist has the row.
          if (
            await upsertStat(
              coreId,
              side,
              teamCoreId,
              key,
              val,
              sourceUpdatedAt,
              dryRun
            )
          ) {
            statsUpserted++;
          }
        }
      }
    } catch (e) {
      errors.push(
        `fixture ${f.fixtureId}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  // Coverage audit → core_coverage_audit
  let coverageBuckets = 0;
  try {
    const report = await auditHistCoverage();
    for (const b of report.buckets) {
      const competitionId = maps.competitionByProviderId.get(b.leagueId);
      if (competitionId == null) continue;
      const seasonId = maps.seasonByCompAndYear.get(
        `${competitionId}:${b.season}`
      );
      if (seasonId == null || seasonId < 0) {
        coverageBuckets++;
        continue;
      }
      const existing = await db
        .select()
        .from(coreCoverageAudit)
        .where(
          and(
            eq(coreCoverageAudit.competitionId, competitionId),
            eq(coreCoverageAudit.seasonId, seasonId)
          )
        )
        .limit(1);
      const values = {
        expectedFixtures: b.expected_fixtures,
        importedFixtures: b.stored_fixtures,
        withHt: b.with_ht_score,
        withStats: b.with_match_stats,
        withCorners: b.with_corners,
        completeness: b.completeness,
        inventoryPass: b.inventoryPass ? 1 : 0,
        providerHole: b.providerHole ? 1 : 0,
        providerHoleReason: b.providerHoleReason,
        auditedAt: now,
      };
      if (!dryRun) {
        if (existing[0]) {
          await db
            .update(coreCoverageAudit)
            .set(values)
            .where(eq(coreCoverageAudit.id, existing[0].id));
        } else {
          await db.insert(coreCoverageAudit).values({
            competitionId,
            seasonId,
            ...values,
          });
        }
      }
      coverageBuckets++;
    }
  } catch (e) {
    errors.push(
      `coverage: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  let kvTraces = { considered: 0, wouldWrite: 0, wrote: 0 };
  if (!opts.skipKvTraces) {
    try {
      const { loadAllBatches } = await import(
        "@/lib/prediction-log/club-store"
      );
      const batches = await loadAllBatches();
      kvTraces = await bridgePendingBatchesFromKv(batches, { dryRun });
    } catch (e) {
      errors.push(
        `kv traces: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return {
    dryRun,
    competitionsUpserted: seed.competitionsUpserted,
    seasonsUpserted: seed.seasonsUpserted,
    teamsUpserted,
    aliasesUpserted,
    fixturesUpserted,
    fixturesSkippedManual,
    statsUpserted,
    mapsUpserted,
    coverageBuckets,
    kvTraces,
    errors,
  };
}

/** Quick row counts for ops freeze / reconcile. */
export async function countCoreTables(): Promise<Record<string, number>> {
  const db = await getDb();
  const q = (table: string) =>
    sqlCount(db, `SELECT count(*)::int AS c FROM ${table}`);
  return {
    core_competition: await q("core_competition"),
    core_season: await q("core_season"),
    core_team: await q("core_team"),
    core_team_alias: await q("core_team_alias"),
    core_fixture: await q("core_fixture"),
    core_fixture_statistic: await q("core_fixture_statistic"),
    core_legacy_record_map: await q("core_legacy_record_map"),
    core_result_trace: await q("core_result_trace"),
    core_coverage_audit: await q("core_coverage_audit"),
  };
}
