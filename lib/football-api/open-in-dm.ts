/**
 * Find or create a one-match batch for an upcoming fixture (Open in Decision Maker).
 */
import { loadAllBatches, saveBatch } from "@/lib/prediction-log/club-store";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";
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
    return {
      batchId: existingId,
      apiFixtureId: input.apiFixtureId,
      created: false,
    };
  }

  const batch = buildOneMatchBatchFromFixture(input);
  await saveBatch(batch);
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
