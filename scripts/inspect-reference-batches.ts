import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { loadAllBatches } from "@/lib/prediction-log/club-store";

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

async function main() {
  const batches = await loadAllBatches();
  console.log("total batches:", batches.length);
  const refBatches = batches.filter((b) => b.batchName?.startsWith("Reference fixtures"));
  console.log("reference batches:", refBatches.length);
  for (const b of refBatches) {
    console.log(b.id, "|", b.batchName, "|", b.date, "|", b.matches.length, "matches");
  }
  const nonRef = batches.filter((b) => !b.batchName?.startsWith("Reference fixtures"));
  console.log("non-reference batches:", nonRef.length);
  for (const b of nonRef.slice(0, 10)) {
    console.log("  non-ref:", b.id, "|", b.batchName, "|", b.date, "|", b.matches.length, "matches");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
