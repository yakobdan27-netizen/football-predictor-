import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { importReferenceFixtures } from "@/lib/prediction-log/reference-fixtures";

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

async function main() {
  const skipDb = process.argv.includes("--skip-db");
  const skipKv = process.argv.includes("--skip-kv");
  const refDir = path.join(process.cwd(), "data", "reference");
  const results: Record<string, unknown> = {};

  for (const item of IMPORTS) {
    const filePath = path.join(refDir, item.file);
    const csvText = readFileSync(filePath, "utf-8");
    const summary = await importReferenceFixtures({
      csvText,
      batchLabel: `Reference fixtures — ${item.club} — 2025/26`,
      targetClub: item.club,
      primaryLeague: item.league,
      skipDb,
      skipKv,
    });
    results[item.club] = summary;
    console.log(
      `${item.club}: parsed=${summary.parsed} db+${summary.dbInserted} kv+${summary.kvMatches} (dup db=${summary.dbSkippedDuplicates} kv=${summary.kvSkippedDuplicates})`
    );
  }

  console.log("\nFull summary:");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
