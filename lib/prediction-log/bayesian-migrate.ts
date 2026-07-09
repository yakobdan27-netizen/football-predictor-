import type { ClubRecord } from "./club-record-types";
import { applyBayesianObservation, initBayesianMarkets } from "./bayesian-update";
import { lookupTeam } from "./teams-quality";
import type { TeamsQualityStore } from "./teams-quality-types";
import type { LogMatch, PredictionBatch } from "./types";
import { loadClubIndex, loadClubRecord, saveClubRecord } from "./club-store";

function parseGoalsFromOu(actual: string | number | undefined): number | null {
  if (typeof actual === "number" && Number.isFinite(actual)) return actual;
  if (typeof actual !== "string") return null;
  const m = actual.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]!) : null;
}

function replayMatchOnRecord(
  record: ClubRecord,
  match: LogMatch,
  venue: "home" | "away",
  teamsQuality: TeamsQualityStore | null
): ClubRecord {
  const tier = lookupTeam(teamsQuality, record.clubName)?.tier ?? null;
  let updated: ClubRecord = { ...record, bayesianMarkets: initBayesianMarkets(tier) };

  const goalsMarket = venue === "home" ? "home_goals_ou" : "away_goals_ou";
  const concededMarket = venue === "home" ? "away_goals_ou" : "home_goals_ou";
  const goalsScored = parseGoalsFromOu(match.actualResults[goalsMarket]?.actual);
  const goalsConceded = parseGoalsFromOu(match.actualResults[concededMarket]?.actual);

  if (goalsScored != null) {
    updated = applyBayesianObservation(
      updated,
      {
        marketKey: venue === "home" ? "goals_scored_home" : "goals_scored_away",
        gammaCount: goalsScored,
      },
      tier
    );
  }
  if (goalsConceded != null) {
    updated = applyBayesianObservation(
      updated,
      {
        marketKey: venue === "home" ? "goals_conceded_home" : "goals_conceded_away",
        gammaCount: goalsConceded,
      },
      tier
    );
    updated = applyBayesianObservation(
      updated,
      { marketKey: "clean_sheet_rate", betaSuccess: goalsConceded === 0 },
      tier
    );
  }

  const actual1x2 = match.actualResults["1x2"]?.actual;
  if (actual1x2 != null) {
    const sideWin =
      venue === "home"
        ? String(actual1x2).toLowerCase() === "home"
        : String(actual1x2).toLowerCase() === "away";
    const isDraw = String(actual1x2).toLowerCase() === "draw";
    if (!isDraw) {
      updated = applyBayesianObservation(
        updated,
        { marketKey: "win_rate", betaSuccess: sideWin },
        tier
      );
    }
  }

  const bttsActual = match.actualResults["btts"]?.actual;
  if (bttsActual != null) {
    updated = applyBayesianObservation(
      updated,
      {
        marketKey: "btts_rate",
        betaSuccess: String(bttsActual).toLowerCase() === "yes",
      },
      tier
    );
  }

  const ts = match.teamStats?.[venue];
  if (ts) {
    const mappings: Array<[keyof typeof ts, Parameters<typeof applyBayesianObservation>[1]["marketKey"]]> = [
      ["shotsOnTarget", "shots_on_target"],
      ["totalShots", "total_shots"],
      ["corners", "corners"],
      ["yellowCards", "yellow_cards"],
      ["redCards", "red_cards"],
      ["fouls", "fouls"],
    ];
    for (const [field, key] of mappings) {
      const val = ts[field];
      if (val != null && typeof val === "number") {
        updated = applyBayesianObservation(updated, { marketKey: key, gammaCount: val }, tier);
      }
    }
  }

  return updated;
}

export async function migrateClubBayesianFromBatches(
  batches: PredictionBatch[],
  teamsQuality: TeamsQualityStore | null,
  force = false
): Promise<{ clubsUpdated: number; skipped: number }> {
  const index = await loadClubIndex();
  let clubsUpdated = 0;
  let skipped = 0;

  const sortedBatches = [...batches].sort((a, b) => a.date.localeCompare(b.date));

  for (const entry of index.clubs) {
    const record = await loadClubRecord(entry.clubId);
    if (!record) continue;
    if (record.bayesianMarkets?.version === 1 && !force) {
      skipped++;
      continue;
    }

    const tier = lookupTeam(teamsQuality, record.clubName)?.tier ?? null;
    let updated: ClubRecord = { ...record, bayesianMarkets: initBayesianMarkets(tier) };

    for (const batch of sortedBatches) {
      for (const match of batch.matches) {
        const isHome =
          match.homeClubId === record.clubId ||
          match.homeTeam.toLowerCase() === record.clubName.toLowerCase();
        const isAway =
          match.awayClubId === record.clubId ||
          match.awayTeam.toLowerCase() === record.clubName.toLowerCase();
        if (isHome) updated = replayMatchOnRecord(updated, match, "home", teamsQuality);
        if (isAway) updated = replayMatchOnRecord(updated, match, "away", teamsQuality);
      }
    }

    await saveClubRecord(updated);
    clubsUpdated++;
  }

  return { clubsUpdated, skipped };
}
