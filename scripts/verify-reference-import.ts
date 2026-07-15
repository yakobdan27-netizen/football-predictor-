import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { loadAllBatches, loadClubIndex, loadClubRecord } from "@/lib/prediction-log/club-store";
import {
  involvesClub,
  parseReferenceFixtureCsv,
} from "@/lib/prediction-log/reference-fixtures";
import { standardizeTeamName } from "@/lib/data/team-names";

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

const CLUBS: { file: string; club: string; league: string }[] = [
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

function countClubMatchesInBatches(
  batches: Awaited<ReturnType<typeof loadAllBatches>>,
  club: string
): number {
  const std = standardizeTeamName(club).toLowerCase();
  let count = 0;
  for (const batch of batches) {
    if (!batch.batchName?.startsWith("Reference fixtures")) continue;
    for (const m of batch.matches) {
      const home = m.homeTeam.toLowerCase();
      const away = m.awayTeam.toLowerCase();
      if (home === std || away === std || home.includes(std) || away.includes(std)) {
        count += 1;
      }
    }
  }
  return count;
}

async function main() {
  const refDir = path.join(process.cwd(), "data", "reference");
  const batches = await loadAllBatches();
  const refBatches = batches.filter((b) => b.batchName?.startsWith("Reference fixtures"));
  const clubIndex = await loadClubIndex();

  console.log(`reference batches: ${refBatches.length}`);
  console.log(`clubs in index: ${clubIndex.clubs.length}\n`);

  let allOk = true;
  for (const item of CLUBS) {
    const csvText = readFileSync(path.join(refDir, item.file), "utf-8");
    const parsed = parseReferenceFixtureCsv(csvText).filter((r) =>
      involvesClub(r, item.club)
    );
    const kvMatches = countClubMatchesInBatches(batches, item.club);
    const entry = clubIndex.clubs.find(
      (c) => standardizeTeamName(c.clubName) === standardizeTeamName(item.club)
    );
    const record = entry ? await loadClubRecord(entry.clubId) : null;
    const historyEntries = record
      ? record.histories.winLose.filter((e) => !e.superseded).length
      : 0;
    const sampleSize = record?.capacity?.sampleSize ?? 0;

    const ok = kvMatches > 0 && record != null;
    if (!ok) allOk = false;

    console.log(
      `${item.club.padEnd(16)} csv=${String(parsed.length).padStart(3)} kv=${String(kvMatches).padStart(3)} history=${String(historyEntries).padStart(3)} sample=${String(sampleSize).padStart(3)} ${ok ? "OK" : "MISSING"}`
    );
  }

  console.log(`\n${allOk ? "All 18 clubs verified." : "Some clubs missing data."}`);
  if (!allOk) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
