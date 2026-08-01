/**
 * Find or create a one-match batch for an upcoming fixture (Open in Decision Maker).
 */
import { loadAllBatches, loadBatch, saveBatch } from "@/lib/prediction-log/club-store";
import { fetchDmAfEnrichment } from "@/lib/prediction-log/decision-maker/af-enrich";
import type {
  LogMarketKey,
  LogMatch,
  MarketPrediction,
  PredictionBatch,
} from "@/lib/prediction-log/types";
import type { UpcomingFixtureRow } from "./fetch-upcoming-league";

export interface OpenInDmInput {
  apiFixtureId: number;
  matchDate: string;
  kickoffIso?: string;
  home: { id?: number | null; name: string };
  away: { id?: number | null; name: string };
  league: string;
  status?: string;
}

export interface OpenInDmResult {
  batchId: string;
  apiFixtureId: number;
  created: boolean;
}

export function findBatchIdByApiFixtureId(
  batches: PredictionBatch[],
  apiFixtureId: number
): string | null {
  for (const batch of batches) {
    if (batch.matches.some((m) => m.apiFixtureId === apiFixtureId)) {
      return batch.id;
    }
  }
  return null;
}

function newBatchId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return `NM-${rand}`;
}

export function buildOneMatchBatchFromFixture(
  input: OpenInDmInput
): PredictionBatch {
  const id = newBatchId();
  const home = input.home.name.trim();
  const away = input.away.name.trim();
  const match: LogMatch = {
    id: `${id}-m1`,
    homeTeam: home,
    awayTeam: away,
    league: input.league,
    matchDate: input.matchDate.slice(0, 10),
    apiFixtureId: input.apiFixtureId,
    fixtureStatus: (input.status ?? "NS").trim().toUpperCase(),
    homeApiTeamId: input.home.id ?? undefined,
    awayApiTeamId: input.away.id ?? undefined,
    predictions: {},
    actualResults: {},
    scored: {},
  };
  return {
    id,
    date: match.matchDate!,
    league: input.league,
    batchName: `Next: ${home} vs ${away}`,
    createdAt: new Date().toISOString(),
    batchKind: "manual",
    source: "web",
    matches: [match],
  };
}

/** Soft-fill bookmaker odds into empty prediction slots (never invents picks). */
async function softMergeAfOddsIntoBatch(
  batchId: string,
  apiFixtureId: number
): Promise<void> {
  try {
    const batch = await loadBatch(batchId);
    if (!batch) return;
    const match = batch.matches.find((m) => m.apiFixtureId === apiFixtureId);
    if (!match) return;

    const enrich = await fetchDmAfEnrichment(apiFixtureId);
    if (!enrich.odds.length && !enrich.stats) return;

    const mapKey = (
      marketType: string,
      label: string
    ): LogMarketKey | null => {
      if (marketType === "1X2" && label === "Home") return "1x2";
      if (marketType === "OU_2_5" && label === "Over") return "total_goals_ou";
      if (marketType === "BTTS" && label === "Yes") return "btts";
      return null;
    };

    let changed = false;
    const predictions = { ...match.predictions };
    for (const o of enrich.odds) {
      if (o.odd == null) continue;
      const key = mapKey(o.marketType, o.selectionLabel);
      if (!key) continue;
      const existing = predictions[key];
      if (existing?.odds != null) continue;
      // Odds only — empty prediction means "no pick yet" (never invent a side).
      const next: MarketPrediction = {
        prediction: existing?.prediction ?? "",
        confidence: existing?.confidence ?? 0,
        odds: o.odd,
        line: existing?.line,
      };
      predictions[key] = next;
      changed = true;
    }

    if (enrich.stats) {
      const ts = match.teamStats ?? { home: {}, away: {} };
      const home = { ...ts.home };
      const away = { ...ts.away };
      if (home.corners == null && enrich.stats.homeCorners != null) {
        home.corners = enrich.stats.homeCorners;
        changed = true;
      }
      if (away.corners == null && enrich.stats.awayCorners != null) {
        away.corners = enrich.stats.awayCorners;
        changed = true;
      }
      if (home.totalShots == null && enrich.stats.homeShots != null) {
        home.totalShots = enrich.stats.homeShots;
        changed = true;
      }
      if (away.totalShots == null && enrich.stats.awayShots != null) {
        away.totalShots = enrich.stats.awayShots;
        changed = true;
      }
      if (home.possession == null && enrich.stats.homePossession != null) {
        home.possession = enrich.stats.homePossession;
        changed = true;
      }
      if (away.possession == null && enrich.stats.awayPossession != null) {
        away.possession = enrich.stats.awayPossession;
        changed = true;
      }
      match.teamStats = { ...ts, home, away };
    }

    if (!changed) return;
    match.predictions = predictions;
    await saveBatch({
      ...batch,
      matches: batch.matches.map((m) => (m.id === match.id ? match : m)),
    });
  } catch {
    // Soft-fail — DM still opens
  }
}

export async function findOrCreateBatchForFixture(
  input: OpenInDmInput
): Promise<OpenInDmResult> {
  if (!input.apiFixtureId || !input.home.name.trim() || !input.away.name.trim()) {
    throw new Error("apiFixtureId, home, and away are required");
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(input.matchDate)) {
    throw new Error("matchDate must be YYYY-MM-DD");
  }

  const all = await loadAllBatches();
  const existingId = findBatchIdByApiFixtureId(all, input.apiFixtureId);
  if (existingId) {
    await softMergeAfOddsIntoBatch(existingId, input.apiFixtureId);
    return {
      batchId: existingId,
      apiFixtureId: input.apiFixtureId,
      created: false,
    };
  }

  const batch = buildOneMatchBatchFromFixture(input);
  await saveBatch(batch);
  await softMergeAfOddsIntoBatch(batch.id, input.apiFixtureId);
  return {
    batchId: batch.id,
    apiFixtureId: input.apiFixtureId,
    created: true,
  };
}

/** Map list row → open-in-dm input. */
export function upcomingRowToOpenInput(row: UpcomingFixtureRow): OpenInDmInput {
  return {
    apiFixtureId: row.apiFixtureId,
    matchDate: row.matchDate,
    kickoffIso: row.kickoffIso,
    home: row.home,
    away: row.away,
    league: row.league,
    status: row.status,
  };
}
