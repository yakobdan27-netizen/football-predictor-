/**
 * Seed six competitions + season skeleton for the hist 11-year window.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { coreCompetition, coreSeason } from "@/lib/db/schema";
import { HIST_LEAGUES, histSeasonYears } from "@/lib/hist/seasons";

const COUNTRY_BY_LEAGUE: Record<number, string | null> = {
  39: "England",
  140: "Spain",
  135: "Italy",
  78: "Germany",
  61: "France",
  2: null,
};

export type SeedCompetitionsResult = {
  competitionsUpserted: number;
  seasonsUpserted: number;
  competitionIds: Map<number, number>;
  seasonIds: Map<string, number>;
};

function seasonKey(competitionId: number, providerSeason: number): string {
  return `${competitionId}:${providerSeason}`;
}

/**
 * Idempotent upsert of HIST_LEAGUES + histSeasonYears into core_competition / core_season.
 */
export async function seedCompetitionsAndSeasons(opts?: {
  today?: Date;
  dryRun?: boolean;
}): Promise<SeedCompetitionsResult> {
  const dryRun = opts?.dryRun === true;
  const db = await getDb();
  const now = new Date();
  const seasons = histSeasonYears({ today: opts?.today });
  const competitionIds = new Map<number, number>();
  const seasonIds = new Map<string, number>();
  let competitionsUpserted = 0;
  let seasonsUpserted = 0;

  for (const league of HIST_LEAGUES) {
    const compType = league.type === "cup" ? "cup" : "domestic_league";
    const existing = await db
      .select()
      .from(coreCompetition)
      .where(eq(coreCompetition.providerCompetitionId, league.id))
      .limit(1);

    let competitionId: number;
    if (existing[0]) {
      competitionId = existing[0].id;
      if (!dryRun) {
        await db
          .update(coreCompetition)
          .set({
            name: league.name,
            country: COUNTRY_BY_LEAGUE[league.id] ?? null,
            compType,
          })
          .where(eq(coreCompetition.id, competitionId));
      }
      competitionsUpserted++;
    } else if (dryRun) {
      competitionId = -league.id;
      competitionsUpserted++;
    } else {
      const inserted = await db
        .insert(coreCompetition)
        .values({
          providerName: "api-sports",
          providerCompetitionId: league.id,
          name: league.name,
          country: COUNTRY_BY_LEAGUE[league.id] ?? null,
          compType,
          createdAt: now,
        })
        .returning({ id: coreCompetition.id });
      competitionId = inserted[0]!.id;
      competitionsUpserted++;
    }
    competitionIds.set(league.id, competitionId);

    for (const providerSeason of seasons) {
      const label = `${providerSeason}/${String(providerSeason + 1).slice(-2)}`;
      const sk = seasonKey(competitionId, providerSeason);
      if (dryRun && competitionId < 0) {
        seasonIds.set(sk, -1);
        seasonsUpserted++;
        continue;
      }
      const existingSeason = await db
        .select()
        .from(coreSeason)
        .where(eq(coreSeason.competitionId, competitionId));
      const hit = existingSeason.find((s) => s.providerSeason === providerSeason);
      if (hit) {
        seasonIds.set(sk, hit.id);
        if (!dryRun) {
          await db
            .update(coreSeason)
            .set({ label })
            .where(eq(coreSeason.id, hit.id));
        }
        seasonsUpserted++;
      } else if (dryRun) {
        seasonIds.set(sk, -1);
        seasonsUpserted++;
      } else {
        const inserted = await db
          .insert(coreSeason)
          .values({
            competitionId,
            providerSeason,
            label,
            createdAt: now,
          })
          .returning({ id: coreSeason.id });
        seasonIds.set(sk, inserted[0]!.id);
        seasonsUpserted++;
      }
    }
  }

  return {
    competitionsUpserted,
    seasonsUpserted,
    competitionIds,
    seasonIds,
  };
}
