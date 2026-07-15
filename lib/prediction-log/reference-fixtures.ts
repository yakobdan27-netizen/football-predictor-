import { and, eq, isNull, or } from "drizzle-orm";
import type { MatchRow } from "@/lib/predictor/types";
import { standardizeTeamName } from "@/lib/data/team-names";
import { cleanMatchRows } from "@/lib/data/clean-matches";
import { rowToDbInsert } from "@/lib/csv";
import { getDb, schema } from "@/lib/db";
import { syncBatchToClubHistories } from "./club-history-writer";
import { loadAllBatches, saveBatch } from "./club-store";
import { computeLeagueBaselines } from "./league-baselines";
import { maybeBayesianCalibrateOnBatch } from "./bayesian-calibration";
import { maybeRetrainOnBatchResult } from "./retrain-ml";
import { resolveLeagueId } from "./league-registry";
import { applyTeamStatsSync } from "./team-stats-sync";
import { loadTeamsQualityStore } from "./teams-quality-store";
import { deriveBatchLeague } from "./match-league";
import type { LogMatch, PredictionBatch } from "./types";

const COMPETITION_TO_LEAGUE: Record<string, string> = {
  "Premier League": "Premier League",
  "Champions League": "UEFA Champions League",
  "UEFA Champions League": "UEFA Champions League",
  "FA Cup": "Premier League",
  "EFL Cup": "Premier League",
  "Carabao Cup": "Premier League",
  "Community Shield": "Premier League",
  "La Liga": "La Liga",
  "Copa del Rey": "La Liga",
  "Spanish Super Cup": "La Liga",
  "Supercopa de España": "La Liga",
  "Ligue 1": "Ligue 1",
  "Coupe de France": "Ligue 1",
  "Trophée des Champions": "Ligue 1",
  "Bundesliga": "Bundesliga",
  "DFB-Pokal": "Bundesliga",
  "DFL-Supercup": "Bundesliga",
  "Franz Beckenbauer Supercup": "Bundesliga",
  "UEFA Super Cup": "UEFA Champions League",
  Supercopa: "La Liga",
};

const MONTH_MAP: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

export interface ReferenceFixtureRow {
  competition: string;
  date: string;
  matchday: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}

export interface ReferenceImportSummary {
  parsed: number;
  dbInserted: number;
  dbSkippedDuplicates: number;
  kvMatches: number;
  kvSkippedDuplicates: number;
  batchId?: string;
}

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function parseReferenceDate(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (m) {
    const day = m[1]!.padStart(2, "0");
    const month = MONTH_MAP[m[2]!] ?? "01";
    const yy = parseInt(m[3]!, 10);
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    return `${year}-${month}-${day}`;
  }
  return trimmed;
}

function parseScoreColumn(raw: string): { home: number; away: number } | null {
  const cleaned = raw.trim().replace(/\s+pens$/i, "");
  const m = cleaned.match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  return { home: parseInt(m[1]!, 10), away: parseInt(m[2]!, 10) };
}

/** Canonical key for same fixture regardless of home/away orientation in source lists. */
export function canonicalFixtureKey(row: ReferenceFixtureRow): string {
  const [t1, t2] = [row.homeTeam, row.awayTeam].sort();
  const t1Goals = row.homeTeam === t1 ? row.homeScore : row.awayScore;
  const t2Goals = row.homeTeam === t1 ? row.awayScore : row.homeScore;
  return `${row.date}|${t1.toLowerCase()}|${t2.toLowerCase()}|${t1Goals}|${t2Goals}`;
}

export function mapCompetitionToLeague(
  competition: string,
  primaryLeague?: string
): string {
  const mapped = COMPETITION_TO_LEAGUE[competition];
  if (mapped) return mapped;
  return primaryLeague ?? "Premier League";
}

export function parseReferenceFixtureCsv(text: string): ReferenceFixtureRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0]!.split(",").map((h) => h.trim());
  const isFormatB =
    headers.includes("Home") &&
    headers.includes("Away") &&
    headers.includes("Score");

  const seen = new Set<string>();
  const rows: ReferenceFixtureRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const values = line.split(",").map((v) => v.trim());
    if (values[0] === "Date" || values[0] === "Competition") continue;

    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = values[j] ?? "";
    });

    let parsed: ReferenceFixtureRow | null = null;

    if (isFormatB) {
      const homeRaw = row.Home ?? "";
      const awayRaw = row.Away ?? "";
      if (!homeRaw || !awayRaw) continue;

      const score = parseScoreColumn(row.Score ?? "");
      if (!score) continue;

      parsed = {
        competition: row.Competition ?? "",
        date: parseReferenceDate(row.Date ?? ""),
        matchday: "",
        homeTeam: standardizeTeamName(homeRaw),
        awayTeam: standardizeTeamName(awayRaw),
        homeScore: score.home,
        awayScore: score.away,
      };
    } else {
      const homeRaw = row.HomeTeam ?? row.home_team ?? "";
      const awayRaw = row.AwayTeam ?? row.away_team ?? "";
      if (!homeRaw || !awayRaw || homeRaw === "TBD") continue;

      const homeScore = parseInt(
        row.HomeScore ?? row.FTHG ?? row.home_score ?? "",
        10
      );
      const awayScore = parseInt(
        row.AwayScore ?? row.FTAG ?? row.away_score ?? "",
        10
      );
      if (isNaN(homeScore) || isNaN(awayScore)) continue;
      if (
        /pending/i.test(String(row.HomeScore ?? "")) ||
        /pending/i.test(String(row.AwayScore ?? ""))
      ) {
        continue;
      }

      parsed = {
        competition: row.Competition ?? "Premier League",
        date: parseReferenceDate(row.Date ?? row.date ?? ""),
        matchday: row.Matchday ?? "",
        homeTeam: standardizeTeamName(homeRaw),
        awayTeam: standardizeTeamName(awayRaw),
        homeScore,
        awayScore,
      };
    }

    if (!parsed) continue;

    const dedupeKey = canonicalFixtureKey(parsed);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    rows.push(parsed);
  }

  return rows;
}

export function referenceRowsToMatchRows(rows: ReferenceFixtureRow[]): MatchRow[] {
  return rows.map((row) => ({
    Date: row.date,
    HomeTeam: row.homeTeam,
    AwayTeam: row.awayTeam,
    FTHG: row.homeScore,
    FTAG: row.awayScore,
  }));
}

export function referenceRowToLogMatch(
  row: ReferenceFixtureRow,
  id: string,
  primaryLeague?: string
): LogMatch {
  const base: LogMatch = {
    id,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    league: mapCompetitionToLeague(row.competition, primaryLeague),
    // True per-match date — these bulk imports bundle a whole season's rows under one
    // batch, so `batch.date` alone (the batch's latest date) is not usable per-match.
    matchDate: row.date,
    predictions: {},
    actualResults: {},
    scored: {},
    resultSource: "manual",
    teamStats: {
      home: { goals: row.homeScore },
      away: { goals: row.awayScore },
    },
  };
  return applyTeamStatsSync(base);
}

export function involvesClub(row: ReferenceFixtureRow, club: string): boolean {
  const std = standardizeTeamName(club).toLowerCase();
  const home = row.homeTeam.toLowerCase();
  const away = row.awayTeam.toLowerCase();
  return (
    home === std ||
    away === std ||
    home.includes(std) ||
    away.includes(std)
  );
}

function buildExistingCanonicalKeys(batches: PredictionBatch[]): Set<string> {
  const keys = new Set<string>();
  for (const batch of batches) {
    for (const match of batch.matches) {
      const goalsH = match.teamStats?.home?.goals;
      const goalsA = match.teamStats?.away?.goals;
      if (goalsH == null || goalsA == null) continue;
      try {
        const row: ReferenceFixtureRow = {
          competition: match.league ?? "",
          // Prefer the match's own true date (bulk imports) over the shared batch
          // date, which for normal single-gameday batches is the same value anyway.
          date: match.matchDate ?? batch.date,
          matchday: "",
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          homeScore: goalsH,
          awayScore: goalsA,
        };
        keys.add(canonicalFixtureKey(row));
      } catch {
        /* skip invalid */
      }
    }
  }
  return keys;
}

async function importToPostgres(rows: ReferenceFixtureRow[]): Promise<{
  inserted: number;
  skippedDuplicates: number;
}> {
  const matchRows = referenceRowsToMatchRows(rows);
  const { rows: cleaned } = cleanMatchRows(matchRows);
  if (cleaned.length === 0) {
    return { inserted: 0, skippedDuplicates: 0 };
  }

  const db = await getDb();
  let inserted = 0;
  let skippedDuplicates = 0;

  for (const row of cleaned) {
    const insert = rowToDbInsert(row);
    const date = insert.matchDate;
    const existing = await db
      .select({ id: schema.matches.id })
      .from(schema.matches)
      .where(
        and(
          eq(schema.matches.homeTeam, insert.homeTeam),
          eq(schema.matches.awayTeam, insert.awayTeam),
          eq(schema.matches.fthg, insert.fthg),
          eq(schema.matches.ftag, insert.ftag),
          date
            ? eq(schema.matches.matchDate, date)
            : or(
                isNull(schema.matches.matchDate),
                eq(schema.matches.matchDate, "")
              )
        )
      )
      .limit(1);

    if (existing.length > 0) {
      skippedDuplicates += 1;
      continue;
    }

    await db.insert(schema.matches).values(insert);
    inserted += 1;
  }

  return { inserted, skippedDuplicates };
}

/**
 * Builds a club's reference-fixture batch: dedupes against `existingKeys` (mutated
 * in place so callers can accumulate dedup state across multiple clubs), and sorts
 * matches chronologically by their true date so history-writer consumers with
 * order-sensitive decay (e.g. the Bayesian layer) see a correct sequence — source
 * CSV row order is not guaranteed to be chronological.
 */
export function buildReferenceClubBatch(
  rows: ReferenceFixtureRow[],
  batchLabel: string,
  primaryLeague: string | undefined,
  existingKeys: Set<string>
): { batch: PredictionBatch | null; skippedDuplicates: number } {
  const kept: ReferenceFixtureRow[] = [];
  let skippedDuplicates = 0;

  for (const row of rows) {
    const key = canonicalFixtureKey(row);
    if (existingKeys.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    kept.push(row);
    existingKeys.add(key);
  }

  if (kept.length === 0) {
    return { batch: null, skippedDuplicates };
  }

  kept.sort((a, b) => a.date.localeCompare(b.date));
  const matches = kept.map((row) => referenceRowToLogMatch(row, newId(), primaryLeague));
  const batchDate = kept[kept.length - 1]!.date;
  const batchLeague = deriveBatchLeague(matches, primaryLeague);

  const batch: PredictionBatch = {
    id: newId(),
    date: batchDate,
    league: batchLeague,
    leagueId: resolveLeagueId(batchLeague),
    batchName: batchLabel,
    createdAt: new Date().toISOString(),
    batchKind: "manual",
    matches,
  };

  return { batch, skippedDuplicates };
}

async function importToClubHistories(
  rows: ReferenceFixtureRow[],
  batchLabel: string,
  primaryLeague?: string
): Promise<{ matches: number; skippedDuplicates: number; batchId: string }> {
  const existingBatches = await loadAllBatches();
  const existingKeys = buildExistingCanonicalKeys(existingBatches);

  const { batch, skippedDuplicates } = buildReferenceClubBatch(
    rows,
    batchLabel,
    primaryLeague,
    existingKeys
  );

  if (!batch) {
    return { matches: 0, skippedDuplicates, batchId: "" };
  }

  const leagueBaselines = computeLeagueBaselines(existingBatches);
  const teamsQuality = await loadTeamsQualityStore().catch(() => null);
  const synced = await syncBatchToClubHistories(batch, {
    leagueBaselines,
    teamsQuality,
  });
  await saveBatch(synced);
  await maybeRetrainOnBatchResult(synced).catch(() => null);
  await maybeBayesianCalibrateOnBatch(synced).catch(() => null);

  const matches = synced.matches;

  return { matches: matches.length, skippedDuplicates, batchId: synced.id };
}

export async function importReferenceFixtures(options: {
  csvText: string;
  batchLabel?: string;
  targetClub?: string;
  primaryLeague?: string;
  skipKv?: boolean;
  skipDb?: boolean;
}): Promise<ReferenceImportSummary> {
  let rows = parseReferenceFixtureCsv(options.csvText);
  if (options.targetClub) {
    rows = rows.filter((row) => involvesClub(row, options.targetClub!));
  }

  const summary: ReferenceImportSummary = {
    parsed: rows.length,
    dbInserted: 0,
    dbSkippedDuplicates: 0,
    kvMatches: 0,
    kvSkippedDuplicates: 0,
  };

  if (!options.skipDb && rows.length > 0) {
    const dbResult = await importToPostgres(rows);
    summary.dbInserted = dbResult.inserted;
    summary.dbSkippedDuplicates = dbResult.skippedDuplicates;
  }

  if (!options.skipKv && rows.length > 0) {
    const label =
      options.batchLabel ??
      `Reference fixtures — ${options.targetClub ?? "all teams"} — 2025/26`;
    const kvResult = await importToClubHistories(
      rows,
      label,
      options.primaryLeague
    );
    summary.kvMatches = kvResult.matches;
    summary.kvSkippedDuplicates = kvResult.skippedDuplicates;
    summary.batchId = kvResult.batchId || undefined;
  }

  return summary;
}
