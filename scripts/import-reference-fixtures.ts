import { readFileSync } from "node:fs";
import path from "node:path";
import { importReferenceFixtures } from "@/lib/prediction-log/reference-fixtures";

async function main() {
  const fileArg = process.argv[2];
  const clubArg = process.argv.find((a) => a.startsWith("--club="))?.split("=")[1];
  const leagueArg = process.argv.find((a) => a.startsWith("--league="))?.split("=")[1];
  const skipDb = process.argv.includes("--skip-db");
  const skipKv = process.argv.includes("--skip-kv");

  const filePath = fileArg
    ? path.resolve(fileArg)
    : path.join(process.cwd(), "data", "reference", "manchester-city-2526.csv");

  const csvText = readFileSync(filePath, "utf-8");
  const batchLabel = clubArg
    ? `Reference fixtures — ${clubArg} — 2025/26`
    : `Reference fixtures — 2025/26`;

  const summary = await importReferenceFixtures({
    csvText,
    batchLabel,
    targetClub: clubArg,
    primaryLeague: leagueArg,
    skipDb,
    skipKv,
  });

  console.log(JSON.stringify({ filePath, ...summary }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
