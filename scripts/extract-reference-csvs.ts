/**
 * One-time script: extract reference fixture CSVs from chat transcript user messages.
 * Run: npx tsx scripts/extract-reference-csvs.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const TRANSCRIPT =
  "C:/Users/yakob dan/.cursor/projects/c-Users-yakob-dan-Desktop-football/agent-transcripts/2acc3670-624b-45da-9dad-b8ed5ed2be71/2acc3670-624b-45da-9dad-b8ed5ed2be71.jsonl";

const OUT_DIR = path.join(process.cwd(), "data", "reference");

const FORMAT_A_HEADER =
  "Competition,Date,Matchday,HomeTeam,AwayTeam,HomeScore,AwayScore,Result";
const FORMAT_B_HEADER = "Date,Competition,Home,Away,Result,Score";

/** Club patterns for splitting combined bare Format B pastes */
const TRACKED_CLUBS: { file: string; patterns: string[] }[] = [
  { file: "manchester-city-2526.csv", patterns: ["manchester city", "man city"] },
  { file: "manchester-united-2526.csv", patterns: ["manchester united", "man united", "man utd"] },
  { file: "real-madrid-2526.csv", patterns: ["real madrid"] },
  { file: "barcelona-2526.csv", patterns: ["barcelona"] },
  { file: "atletico-madrid-2526.csv", patterns: ["atletico madrid", "atlético madrid", "ath madrid"] },
  { file: "psg-2526.csv", patterns: ["psg", "paris sg", "paris saint"] },
  { file: "bayern-munich-2526.csv", patterns: ["bayern munich", "bayern münchen"] },
  { file: "liverpool-2526.csv", patterns: ["liverpool"] },
  { file: "chelsea-2526.csv", patterns: ["chelsea"] },
  { file: "aston-villa-2526.csv", patterns: ["aston villa"] },
  { file: "everton-2526.csv", patterns: ["everton"] },
  { file: "brighton-2526.csv", patterns: ["brighton"] },
  { file: "sunderland-2526.csv", patterns: ["sunderland"] },
  { file: "crystal-palace-2526.csv", patterns: ["crystal palace"] },
  { file: "bournemouth-2526.csv", patterns: ["bournemouth"] },
  { file: "nottingham-forest-2526.csv", patterns: ["nottingham forest", "nott'm forest"] },
  { file: "newcastle-2526.csv", patterns: ["newcastle"] },
  { file: "tottenham-2526.csv", patterns: ["tottenham"] },
];

const CLUB_FILES: Record<string, string> = Object.fromEntries(
  TRACKED_CLUBS.flatMap((c) => c.patterns.map((p) => [p, c.file]))
);

function extractCsvFromMessage(
  text: string
): { club: string | null; csv: string; bare: boolean } | null {
  const formatA = text.match(
    /(?:^|\n)([a-z][^,\n]*?)[,\s]+(Competition,Date,Matchday,HomeTeam,AwayTeam,HomeScore,AwayScore,Result[\s\S]*)/i
  );
  if (formatA) {
    const club = formatA[1]!.trim().toLowerCase();
    const body = formatA[2]!
      .split("\n")
      .filter((l) => !l.startsWith("<"))
      .join("\n")
      .trim();
    return { club, csv: body, bare: false };
  }

  const formatB = text.match(
    /(?:^|\n)([a-z][a-z0-9' ]+?),\s*(Date,Competition,Home,Away,Result,Score[\s\S]*)/i
  );
  if (formatB) {
    const club = formatB[1]!.trim().toLowerCase();
    if (club !== "date" && club !== "competition") {
      const body = formatB[2]!
        .split("\n")
        .filter((l) => !l.startsWith("<"))
        .join("\n")
        .trim();
      return { club, csv: body, bare: false };
    }
  }

  const bareB = text.match(/(Date,Competition,Home,Away,Result,Score[\s\S]*)/i);
  if (bareB) {
    const body = bareB[1]!
      .split("\n")
      .filter((l) => !l.startsWith("<"))
      .join("\n")
      .trim();
    return { club: null, csv: body, bare: true };
  }

  return null;
}

function resolveClubFile(club: string): string | null {
  const c = club.toLowerCase().replace(/[^a-z0-9' ]/g, "").trim();
  for (const [key, file] of Object.entries(CLUB_FILES)) {
    const k = key.replace(/[^a-z0-9' ]/g, "");
    if (c.includes(k) || k.includes(c)) return file;
  }
  if (c.includes("manch") && c.includes("united")) return "manchester-united-2526.csv";
  if (c.includes("manch") && c.includes("city")) return "manchester-city-2526.csv";
  if (c.includes("nott")) return "nottingham-forest-2526.csv";
  if (c.includes("crystal")) return "crystal-palace-2526.csv";
  if (c.includes("atletico") || c.includes("atlético")) return "atletico-madrid-2526.csv";
  return null;
}

function rowInvolvesClub(
  home: string,
  away: string,
  patterns: string[]
): boolean {
  const h = home.toLowerCase();
  const a = away.toLowerCase();
  return patterns.some((p) => h.includes(p) || a.includes(p));
}

function splitBareCsvByClub(csv: string): Map<string, string[]> {
  const lines = csv.split(/\r?\n/);
  const header = lines[0]!;
  const isFormatB = header.includes("Home") && header.includes("Score");
  const result = new Map<string, string[]>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line === header) continue;

    if (isFormatB) {
      const parts = line.split(",").map((p) => p.trim());
      const home = parts[2] ?? "";
      const away = parts[3] ?? "";
      for (const club of TRACKED_CLUBS) {
        if (rowInvolvesClub(home, away, club.patterns)) {
          const rows = result.get(club.file) ?? [];
          rows.push(line);
          result.set(club.file, rows);
        }
      }
    } else {
      const parts = line.split(",").map((p) => p.trim());
      const home = parts[3] ?? parts[2] ?? "";
      const away = parts[4] ?? parts[3] ?? "";
      for (const club of TRACKED_CLUBS) {
        if (rowInvolvesClub(home, away, club.patterns)) {
          const rows = result.get(club.file) ?? [];
          rows.push(line);
          result.set(club.file, rows);
        }
      }
    }
  }

  return result;
}

function dedupeCsvLines(header: string, dataLines: string[]): string {
  const seen = new Set<string>();
  const seenCanonical = new Set<string>();
  const out = [header];
  const isFormatB = header.includes("Home") && header.includes("Score");

  for (const line of dataLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === header) continue;
    if (seen.has(trimmed)) continue;

    if (isFormatB) {
      const parts = trimmed.split(",").map((p) => p.trim());
      if (parts.length >= 6) {
        const date = parts[0]!;
        const home = parts[2]!;
        const away = parts[3]!;
        const score = parts[5]!.replace(/\s+pens$/i, "");
        const teams = [home.toLowerCase(), away.toLowerCase()].sort().join("|");
        const canon = `${date}|${teams}|${score}`;
        if (seenCanonical.has(canon)) continue;
        seenCanonical.add(canon);
      }
    }

    seen.add(trimmed);
    out.push(trimmed);
  }
  return out.join("\n") + "\n";
}

function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const accum = new Map<string, { header: string; lines: Set<string> }>();

  const lines = readFileSync(TRANSCRIPT, "utf-8").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    let j: { role?: string; message?: { content?: { type: string; text?: string }[] } };
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j.role !== "user") continue;
    const text = j.message?.content?.find((c) => c.type === "text")?.text ?? "";
    const extracted = extractCsvFromMessage(text);
    if (!extracted) continue;

    const header = extracted.csv.split(/\r?\n/)[0]!;
    const dataLines = extracted.csv.split(/\r?\n/).slice(1).filter(Boolean);

    const addLines = (file: string, rows: string[]) => {
      const entry = accum.get(file) ?? { header, lines: new Set<string>() };
      entry.header = header;
      for (const r of rows) entry.lines.add(r);
      accum.set(file, entry);
    };

    if (extracted.bare) {
      const split = splitBareCsvByClub(extracted.csv);
      for (const [file, rows] of split) {
        addLines(file, rows);
      }
    } else {
      const filename = resolveClubFile(extracted.club ?? "");
      if (!filename) {
        console.warn("Unknown club prefix:", extracted.club);
        continue;
      }
      addLines(filename, dataLines);
    }
  }

  const written: Record<string, number> = {};
  for (const [file, { header, lines: lineSet }] of accum) {
    const deduped = dedupeCsvLines(header, [...lineSet]);
    const rowCount = deduped.trim().split("\n").length - 1;
    writeFileSync(path.join(OUT_DIR, file), deduped, "utf-8");
    written[file] = rowCount;
  }

  console.log("Written CSV files:");
  for (const [file, rows] of Object.entries(written).sort()) {
    console.log(`  ${file}: ${rows} rows`);
  }
}

main();
