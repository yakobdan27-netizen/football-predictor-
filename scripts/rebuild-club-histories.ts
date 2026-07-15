/**
 * Remediation script: fixes production data corrupted by an earlier reference-fixture
 * import bug.
 *
 * Root cause: `importToClubHistories` stored every match in a club's season-long CSV
 * under ONE `PredictionBatch.date` (the last match's date), and its cross-batch dedup
 * check re-derived "existing" keys using that same single `batch.date` for every match.
 * That works for normal single-gameday batches but is wrong for a batch spanning many
 * real dates: dedup checks against those batches almost always missed, so a re-run
 * (triggered here by a transient KV network failure) created duplicate club-history
 * entries for six clubs (Man City, Man United, Liverpool, Chelsea, Aston Villa, Everton).
 * All ten successfully-imported reference clubs also had every match's club-history
 * entries dated as the batch's last match date instead of the true per-match date.
 *
 * Fix already applied to the codebase (see reference-fixtures.ts / club-history-writer.ts):
 * `LogMatch.matchDate` now carries the true per-match date, dedup uses it, and rows are
 * sorted chronologically before syncing.
 *
 * This script:
 *  1. Deletes the corrupted reference-fixture batches from KV.
 *  2. Wipes the derived club-record store (ClubIndex + all ClubRecord entries) — it is
 *     fully rebuilt from batch data, so nothing legitimate is lost.
 *  3. Re-parses all 18 reference CSVs with the fixed importer and saves one clean batch
 *     per club (matches sorted chronologically, `matchDate` set, globally deduped).
 *  4. Replays every match — reference matches individually by true date, non-reference
 *     batches as their original units — through `syncBatchToClubHistories` in global
 *     chronological order, so order-sensitive Bayesian decay sees a correct sequence.
 *  5. Recomputes and saves league baselines + the ML classifier once at the end, since
 *     the buggy run left those reflecting a stale partial import.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  buildReferenceClubBatch,
  involvesClub,
  parseReferenceFixtureCsv,
  type ReferenceFixtureRow,
} from "@/lib/prediction-log/reference-fixtures";
import {
  loadAllBatches,
  saveBatch,
  deleteBatch,
  loadClubIndex,
} from "@/lib/prediction-log/club-store";
import { syncBatchToClubHistories } from "@/lib/prediction-log/club-history-writer";
import { computeLeagueBaselines } from "@/lib/prediction-log/league-baselines";
import { loadTeamsQualityStore } from "@/lib/prediction-log/teams-quality-store";
import { maybeRetrainOnBatchResult } from "@/lib/prediction-log/retrain-ml";
import { delKey } from "@/lib/prediction-log/kv";
import { KV_KEYS } from "@/lib/prediction-log/kv-keys";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf-8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

const IMPORTS: { file: string; club: string; league: string }[] = [
  { file: "manchester-city-2526.csv", club: "Man City", league: "Premier League" },
  { file: "manchester-united-2526.csv", club: "Man United", league: "Premier League" },
  { file: "liverpool-2526.csv", club: "Liverpool", league: "Premier League" },
  { file: "chelsea-2526.csv", club: "Chelsea", league: "Premier League" },
  { file: "aston-villa-2526.csv", club: "Aston Villa", league: "Premier League" },
  { file: "everton-2526.csv", club: "Everton", league: "Premier League" },
  { file: "brighton-2526.csv", club: "Brighton", league: "Premier League" },
  { file: "sunderland-2526.csv", club: "Sunderland", league: "Premier League" },
  { file: "crystal-palace-2526.csv", club: "Crystal Palace", league: "Premier League" },
  { file: "bournemouth-2526.csv", club: "Bournemouth", league: "Premier League" },
  { file: "nottingham-forest-2526.csv", club: "Nott'm Forest", league: "Premier League" },
  { file: "newcastle-2526.csv", club: "Newcastle", league: "Premier League" },
  { file: "tottenham-2526.csv", club: "Tottenham", league: "Premier League" },
  { file: "real-madrid-2526.csv", club: "Real Madrid", league: "La Liga" },
  { file: "barcelona-2526.csv", club: "Barcelona", league: "La Liga" },
  { file: "atletico-madrid-2526.csv", club: "Ath Madrid", league: "La Liga" },
  { file: "psg-2526.csv", club: "Paris SG", league: "Ligue 1" },
  { file: "bayern-munich-2526.csv", club: "Bayern Munich", league: "Bundesliga" },
];

interface ReplayUnit {
  date: string;
  batch: PredictionBatch;
}

async function main() {
  console.log("=== Step 1: inspect current batches ===");
  const currentBatches = await loadAllBatches();
  const referenceBatches = currentBatches.filter((b) =>
    b.batchName?.startsWith("Reference fixtures")
  );
  const nonReferenceBatches = currentBatches.filter(
    (b) => !b.batchName?.startsWith("Reference fixtures")
  );
  console.log(
    `total=${currentBatches.length} reference=${referenceBatches.length} nonReference=${nonReferenceBatches.length}`
  );

  console.log("\n=== Step 2: delete corrupted reference batches ===");
  for (const b of referenceBatches) {
    await deleteBatch(b.id);
    console.log(`deleted batch ${b.id} (${b.batchName}, ${b.matches.length} matches)`);
  }

  console.log("\n=== Step 3: wipe derived club-record store ===");
  const clubIndex = await loadClubIndex();
  for (const entry of clubIndex.clubs) {
    await delKey(KV_KEYS.club(entry.clubId));
  }
  await delKey(KV_KEYS.clubIndex);
  await delKey(KV_KEYS.clubIdCounter);
  console.log(`wiped ${clubIndex.clubs.length} club records + clubIndex + clubIdCounter`);

  console.log("\n=== Step 4: re-parse & rebuild reference batches (fixed importer) ===");
  const refDir = path.join(process.cwd(), "data", "reference");
  const existingKeys = new Set<string>();
  const freshReferenceBatches: PredictionBatch[] = [];

  for (const item of IMPORTS) {
    const filePath = path.join(refDir, item.file);
    const csvText = readFileSync(filePath, "utf-8");
    let rows: ReferenceFixtureRow[] = parseReferenceFixtureCsv(csvText);
    rows = rows.filter((row) => involvesClub(row, item.club));

    const { batch, skippedDuplicates } = buildReferenceClubBatch(
      rows,
      `Reference fixtures — ${item.club} — 2025/26`,
      item.league,
      existingKeys
    );

    if (batch) {
      await saveBatch(batch);
      freshReferenceBatches.push(batch);
      console.log(
        `${item.club}: parsed=${rows.length} kept=${batch.matches.length} dupSkipped=${skippedDuplicates} batchId=${batch.id}`
      );
    } else {
      console.log(`${item.club}: parsed=${rows.length} kept=0 dupSkipped=${skippedDuplicates}`);
    }
  }

  console.log("\n=== Step 5: global chronological replay ===");
  const allBatchesForBaselines = [...nonReferenceBatches, ...freshReferenceBatches];
  const leagueBaselines = computeLeagueBaselines(allBatchesForBaselines);
  const teamsQuality = await loadTeamsQualityStore().catch(() => null);

  const units: ReplayUnit[] = [];
  for (const batch of nonReferenceBatches) {
    units.push({ date: batch.date, batch });
  }
  for (const batch of freshReferenceBatches) {
    for (const match of batch.matches as LogMatch[]) {
      units.push({
        date: match.matchDate ?? batch.date,
        batch: { ...batch, matches: [match] },
      });
    }
  }
  units.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`replay units: ${units.length}`);

  let processed = 0;
  let lastReferenceBatch: PredictionBatch | null = null;
  for (const unit of units) {
    await syncBatchToClubHistories(unit.batch, { leagueBaselines, teamsQuality });
    if (unit.batch.batchName?.startsWith("Reference fixtures")) {
      lastReferenceBatch = unit.batch;
    }
    processed += 1;
    if (processed % 50 === 0) {
      console.log(`  ...${processed}/${units.length} replayed`);
    }
  }
  console.log(`replay complete: ${processed} units processed`);

  console.log("\n=== Step 6: final retrain (league baselines + ML classifier) ===");
  if (lastReferenceBatch) {
    await maybeRetrainOnBatchResult(lastReferenceBatch).catch((err) => {
      console.error("retrain failed:", err);
    });
    console.log("retrain complete");
  } else {
    console.log("no reference batch available to trigger retrain; skipped");
  }

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
