/**
 * Ordered home–away name-pair result tracing for Prediction Log.
 * Never reverses sides; never guesses on ambiguous aliases or repeated meetings.
 */
import { loadAllBatches, saveBatch } from "@/lib/prediction-log/club-store";
import { syncBatchToClubHistories } from "@/lib/prediction-log/club-history-writer";
import { maybeRetrainOnBatchResult } from "@/lib/prediction-log/retrain-ml";
import { maybeBayesianCalibrateOnBatch } from "@/lib/prediction-log/bayesian-calibration";
import { computeLeagueBaselines } from "@/lib/prediction-log/league-baselines";
import { loadTeamsQualityStore } from "@/lib/prediction-log/teams-quality-store";
import { recomputeAndPersistLearnerStats } from "@/lib/prediction-log/learner-stats-store";
import { recomputeAndPersistLeaguePriors } from "@/lib/prediction-log/league-priors-store";
import { recomputePlSeasonCards } from "@/lib/prediction-log/pl-season-store";
import { recomputeLlSeasonCards } from "@/lib/prediction-log/ll-season-store";
import { recomputeBlSeasonCards } from "@/lib/prediction-log/bl-season-store";
import { recomputeSaSeasonCards } from "@/lib/prediction-log/sa-season-store";
import { recomputeL1SeasonCards } from "@/lib/prediction-log/l1-season-store";
import { applyTeamStatsSync } from "@/lib/prediction-log/team-stats-sync";
import {
  scoreMatch,
  scoreBatch,
  marketsEnteredCount,
  batchNeedsResults,
} from "@/lib/prediction-log/scoring";
import { matchLeague } from "@/lib/prediction-log/match-league";
import {
  accumulateTraceState,
  emptyTraceCounts,
  matchNeedsNamePairTrace,
  migrateMatchTraceState,
  type TraceStatusCounts,
} from "@/lib/prediction-log/result-trace";
import type {
  LogMatch,
  PredictionBatch,
  ResultTraceState,
} from "@/lib/prediction-log/types";
import { apiFootballGet, isApiFootballKeyError, sleep } from "./client";
import {
  fetchFixtureByIdCached,
  fetchFixtureStatisticsCached,
  fetchFixtureEventsCached,
  fetchFixtureLineupsCached,
} from "./cache";
import { apiDateOnly, apiLeagueId, apiSeasonFromDate } from "./leagues";
import {
  type ApiFieldConflict,
  type ApiFootballFixture,
  type ApiFootballStatBlock,
  detectApiConflicts,
  mapFixtureToMatchUpdates,
  matchNeedsApiDetailFill,
  matchNeedsGoalEvents,
  matchNeedsLineups,
  matchNeedsStatistics,
  mergeMatchUpdates,
} from "./map-fixture-to-match";
import type { FixtureGoalEvent } from "./fixture-events";
import type { MatchLineups } from "@/lib/prediction-log/types";
import { normalizeApiTeamName } from "./team-resolve";
import { resolveApiTeamId } from "./team-id-map";

export const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);
export const ABANDONED_STATUSES = new Set([
  "AB",
  "AWD",
  "WO",
  "CANC",
  "ABD",
]);

export type TraceDecision =
  | {
      kind: "fill";
      fixture: ApiFootballFixture;
      state: "FILLED";
      note?: string;
    }
  | {
      kind: "metadata";
      fixture?: ApiFootballFixture;
      state: ResultTraceState;
      note: string;
    };

export type OrderedTeamResolve =
  | {
      ok: true;
      homeId: number;
      awayId: number;
      homeName: string;
      awayName: string;
      leagueId: number | null;
      season: number;
    }
  | {
      ok: false;
      ambiguous: boolean;
      note: string;
      suggestions?: string[];
    };

export function statusShort(f: ApiFootballFixture): string {
  return (f.fixture?.status?.short ?? "").trim().toUpperCase();
}

export function isOfficiallyFinal(short: string): boolean {
  return FINISHED_STATUSES.has(short.trim().toUpperCase());
}

export function isAbandonedStatus(short: string): boolean {
  return ABANDONED_STATUSES.has(short.trim().toUpperCase());
}

/** Exact ordered pair: home id/name and away id/name must match saved orientation. */
export function isExactOrderedPair(
  fixture: ApiFootballFixture,
  homeId: number,
  awayId: number
): boolean {
  const hid = fixture.teams?.home?.id;
  const aid = fixture.teams?.away?.id;
  return hid === homeId && aid === awayId;
}

export function isExactOrderedPairByName(
  fixture: ApiFootballFixture,
  homeName: string,
  awayName: string
): boolean {
  const fh = normalizeApiTeamName(fixture.teams?.home?.name ?? "");
  const fa = normalizeApiTeamName(fixture.teams?.away?.name ?? "");
  return (
    fh === normalizeApiTeamName(homeName) &&
    fa === normalizeApiTeamName(awayName)
  );
}

function kickoffMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Kickoffs on/after batch creation day (UTC) — predictions made before the match. */
export function kickoffFloorMs(batch: PredictionBatch): number {
  const iso = (batch.createdAt || batch.date || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return Date.parse(`${iso}T00:00:00.000Z`);
  }
  return 0;
}

export function filterRelevantFixtures(
  fixtures: ApiFootballFixture[],
  homeId: number,
  awayId: number,
  floorMs: number
): ApiFootballFixture[] {
  const byId = new Map<number, ApiFootballFixture>();
  for (const f of fixtures) {
    if (!f.fixture?.id || !isExactOrderedPair(f, homeId, awayId)) continue;
    const short = statusShort(f);
    const ko = kickoffMs(f.fixture.date);
    // Keep non-final even if older status updates; finals only after floor.
    if (isOfficiallyFinal(short) || isAbandonedStatus(short)) {
      if (floorMs > 0 && ko < floorMs) continue;
    }
    byId.set(f.fixture.id, f);
  }
  return [...byId.values()];
}

/**
 * Pure decision over ordered-pair candidates.
 * Never picks among multiple finals by date alone.
 */
export function chooseFixtureForTrace(
  candidates: ApiFootballFixture[]
): TraceDecision {
  if (candidates.length === 0) {
    return {
      kind: "metadata",
      state: "RETRY",
      note: "No exact ordered home–away API fixture found yet",
    };
  }

  const abandoned = candidates.filter((f) =>
    isAbandonedStatus(statusShort(f))
  );
  const finals = candidates.filter((f) => isOfficiallyFinal(statusShort(f)));
  const nonFinal = candidates.filter((f) => {
    const s = statusShort(f);
    return !isOfficiallyFinal(s) && !isAbandonedStatus(s);
  });

  if (finals.length === 1) {
    return { kind: "fill", fixture: finals[0]!, state: "FILLED" };
  }
  if (finals.length > 1) {
    return {
      kind: "metadata",
      state: "AMBIGUOUS",
      note: "More than one finished exact home–away fixture; manual review required",
    };
  }

  if (abandoned.length > 0 && nonFinal.length === 0) {
    return {
      kind: "metadata",
      fixture: abandoned[0],
      state: "NEEDS_REVIEW",
      note: `Fixture status ${statusShort(abandoned[0]!)} — not a normal completed result`,
    };
  }

  if (nonFinal.length === 1) {
    return {
      kind: "metadata",
      fixture: nonFinal[0],
      state: "FOUND_NOT_FINAL",
      note: "Match found — awaiting final result",
    };
  }
  if (nonFinal.length > 1) {
    // Prefer a single in-play or next NS if unambiguous by earliest kickoff — but
    // brief forbids date-only choice among finished; for non-final, pick earliest.
    const sorted = [...nonFinal].sort(
      (a, b) => kickoffMs(a.fixture.date) - kickoffMs(b.fixture.date)
    );
    return {
      kind: "metadata",
      fixture: sorted[0],
      state: "FOUND_NOT_FINAL",
      note: "Match found — awaiting final result",
    };
  }

  return {
    kind: "metadata",
    state: "RETRY",
    note: "No exact ordered home–away API fixture found yet",
  };
}

export async function resolveOrderedTeamIds(opts: {
  homeTeam: string;
  awayTeam: string;
  league?: string | null;
  season?: number;
}): Promise<OrderedTeamResolve> {
  const homeTeam = opts.homeTeam.trim();
  const awayTeam = opts.awayTeam.trim();
  if (!homeTeam || !awayTeam) {
    return {
      ok: false,
      ambiguous: false,
      note: "Fixture not found. Check team names.",
    };
  }

  const season =
    opts.season ?? apiSeasonFromDate(new Date().toISOString().slice(0, 10));

  let home: Awaited<ReturnType<typeof resolveApiTeamId>>;
  let away: Awaited<ReturnType<typeof resolveApiTeamId>>;
  try {
    home = await resolveApiTeamId({
      teamName: homeTeam,
      league: opts.league,
      season,
    });
    away = await resolveApiTeamId({
      teamName: awayTeam,
      league: opts.league ?? undefined,
      season: home.season,
    });
  } catch (e) {
    return {
      ok: false,
      ambiguous: false,
      note: e instanceof Error ? e.message : String(e),
    };
  }

  if (home.ambiguous || away.ambiguous) {
    return {
      ok: false,
      ambiguous: true,
      note: "Team name alias is ambiguous; manual review required",
      suggestions: [...(home.suggestions ?? []), ...(away.suggestions ?? [])],
    };
  }
  if (home.teamId == null) {
    return {
      ok: false,
      ambiguous: false,
      note: `Home team not found: ${homeTeam}. Check team names.`,
      suggestions: home.suggestions,
    };
  }
  if (away.teamId == null) {
    return {
      ok: false,
      ambiguous: false,
      note: `Away team not found: ${awayTeam}. Check team names.`,
      suggestions: away.suggestions,
    };
  }

  return {
    ok: true,
    homeId: home.teamId,
    awayId: away.teamId,
    homeName: normalizeApiTeamName(homeTeam),
    awayName: normalizeApiTeamName(awayTeam),
    leagueId: opts.league ? apiLeagueId(opts.league) : home.leagueId ?? away.leagueId,
    season: home.season,
  };
}

async function fetchH2hAll(
  homeId: number,
  awayId: number
): Promise<ApiFootballFixture[]> {
  try {
    const rows = await apiFootballGet<ApiFootballFixture[]>(
      "/fixtures/headtohead",
      { h2h: `${homeId}-${awayId}`, last: 20 }
    );
    return rows ?? [];
  } catch {
    try {
      const rows = await apiFootballGet<ApiFootballFixture[]>(
        "/fixtures/headtohead",
        { h2h: `${homeId}-${awayId}`, next: 10 }
      );
      return rows ?? [];
    } catch {
      return [];
    }
  }
}

async function fetchTeamSeasonFixtures(
  teamId: number,
  season: number,
  leagueId: number | null
): Promise<ApiFootballFixture[]> {
  const query: Record<string, string | number> = {
    team: teamId,
    season,
  };
  if (leagueId != null) query.league = leagueId;
  try {
    return (await apiFootballGet<ApiFootballFixture[]>("/fixtures", query)) ?? [];
  } catch {
    if (leagueId == null) return [];
    try {
      return (
        (await apiFootballGet<ApiFootballFixture[]>("/fixtures", {
          team: teamId,
          season,
        })) ?? []
      );
    } catch {
      return [];
    }
  }
}

export async function searchFixturesByOrderedPair(opts: {
  homeId: number;
  awayId: number;
  leagueId?: number | null;
  seasons?: number[];
}): Promise<ApiFootballFixture[]> {
  const seasons =
    opts.seasons && opts.seasons.length > 0
      ? opts.seasons
      : [apiSeasonFromDate(new Date().toISOString().slice(0, 10))];
  const collected: ApiFootballFixture[] = [];

  const h2h = await fetchH2hAll(opts.homeId, opts.awayId);
  collected.push(...h2h);
  await sleep(80);

  for (const season of seasons) {
    const rows = await fetchTeamSeasonFixtures(
      opts.homeId,
      season,
      opts.leagueId ?? null
    );
    collected.push(...rows);
    await sleep(80);
  }

  // Deduplicate; keep only exact ordered home/away IDs (never reversed).
  const byId = new Map<number, ApiFootballFixture>();
  for (const f of collected) {
    if (!f.fixture?.id) continue;
    if (!isExactOrderedPair(f, opts.homeId, opts.awayId)) continue;
    byId.set(f.fixture.id, f);
  }
  return [...byId.values()];
}

function applyTraceMetadata(
  match: LogMatch,
  decision: TraceDecision,
  resolved?: { homeName: string; awayName: string }
): LogMatch {
  const now = new Date().toISOString();
  const fixture = decision.kind === "fill" ? decision.fixture : decision.fixture;
  return {
    ...match,
    resultTraceState: decision.state,
    resultTraceCheckedAt: now,
    resultFilled: decision.state === "FILLED" ? true : match.resultFilled ?? false,
    traceNote: decision.note,
    resolvedHomeTeamName: resolved?.homeName ?? match.resolvedHomeTeamName,
    resolvedAwayTeamName: resolved?.awayName ?? match.resolvedAwayTeamName,
    apiFixtureId: fixture?.fixture?.id ?? match.apiFixtureId,
    fixtureStatus: fixture ? statusShort(fixture) : match.fixtureStatus,
    matchDate: fixture
      ? apiDateOnly(fixture.fixture.date)
      : match.matchDate,
    homeApiTeamId: fixture?.teams?.home?.id ?? match.homeApiTeamId,
    awayApiTeamId: fixture?.teams?.away?.id ?? match.awayApiTeamId,
  };
}

export type ApiMatchDetails = {
  stats: ApiFootballStatBlock[] | null;
  events: FixtureGoalEvent[] | null;
  lineups: MatchLineups | undefined;
};

/** Fetch statistics, goal events, and lineups based on what the match still needs. */
export async function fetchApiMatchDetails(
  fixture: ApiFootballFixture,
  match: LogMatch,
  opts?: { full?: boolean }
): Promise<ApiMatchDetails> {
  const fixtureId = fixture.fixture.id;
  const full = opts?.full === true;

  let stats: ApiFootballStatBlock[] | null = null;
  if (full || matchNeedsStatistics(match)) {
    stats = await fetchFixtureStatisticsCached(fixtureId);
    await sleep(80);
  }

  let events: FixtureGoalEvent[] | null = null;
  if (full || matchNeedsGoalEvents(match)) {
    const res = await fetchFixtureEventsCached(fixtureId);
    events = res.events;
    await sleep(80);
  }

  let lineups: MatchLineups | undefined;
  if (full || matchNeedsLineups(match)) {
    lineups = await fetchFixtureLineupsCached(fixtureId, {
      homeTeamId: fixture.teams.home.id ?? match.homeApiTeamId,
      awayTeamId: fixture.teams.away.id ?? match.awayApiTeamId,
    });
    await sleep(80);
  }

  return { stats, events, lineups };
}

export function fillMatchFromFixture(
  match: LogMatch,
  fixture: ApiFootballFixture,
  stats: ApiFootballStatBlock[] | null,
  overwrite: boolean,
  enrichment?: Pick<ApiMatchDetails, "events" | "lineups">
): { merged: LogMatch; conflicts: ApiFieldConflict[] } {
  const conflicts = overwrite ? [] : detectApiConflicts(match, fixture, stats);
  const updates = mapFixtureToMatchUpdates(fixture, stats, match, {
    overwrite,
    events: enrichment?.events,
    lineups: enrichment?.lineups,
  });
  let merged = mergeMatchUpdates(match, updates);
  merged = {
    ...merged,
    apiFixtureId: match.apiFixtureId ?? fixture.fixture.id,
    fixtureStatus: statusShort(fixture),
    matchDate: match.matchDate ?? apiDateOnly(fixture.fixture.date),
    homeApiTeamId: match.homeApiTeamId ?? fixture.teams.home.id,
    awayApiTeamId: match.awayApiTeamId ?? fixture.teams.away.id,
    resultFilled: true,
    resultTraceState: "FILLED",
    resultTraceCheckedAt: new Date().toISOString(),
    resolvedHomeTeamName: normalizeApiTeamName(fixture.teams.home.name),
    resolvedAwayTeamName: normalizeApiTeamName(fixture.teams.away.name),
    traceNote: undefined,
  };
  merged = applyTeamStatsSync(merged);
  merged = scoreMatch(merged);
  return { merged, conflicts };
}

export type EnrichMatchResult = {
  match: LogMatch;
  enriched: boolean;
  conflicts: ApiFieldConflict[];
};

/** Fill missing stats / goal timing / lineups on an already-traced match. */
export async function enrichMatchFromApi(
  match: LogMatch,
  batch: PredictionBatch,
  opts?: { overwrite?: boolean }
): Promise<EnrichMatchResult> {
  const base = migrateMatchTraceState(match);
  if (!matchNeedsApiDetailFill(base)) {
    return { match: base, enriched: false, conflicts: [] };
  }

  let fixture: ApiFootballFixture | null = null;
  if (base.apiFixtureId != null) {
    fixture = await fetchFixtureByIdCached(base.apiFixtureId);
    await sleep(80);
  }
  if (!fixture) {
    const league = matchLeague(base, batch.league);
    const resolved = await resolveOrderedTeamIds({
      homeTeam: base.homeTeam,
      awayTeam: base.awayTeam,
      league,
    });
    if (!resolved.ok) {
      return { match: base, enriched: false, conflicts: [] };
    }
    const raw = await searchFixturesByOrderedPair({
      homeId: resolved.homeId,
      awayId: resolved.awayId,
      leagueId: resolved.leagueId,
      seasons: [resolved.season, resolved.season - 1],
    });
    const candidates = filterRelevantFixtures(
      raw,
      resolved.homeId,
      resolved.awayId,
      kickoffFloorMs(batch)
    );
    const decision = chooseFixtureForTrace(candidates);
    if (decision.kind !== "fill") {
      return { match: base, enriched: false, conflicts: [] };
    }
    fixture = decision.fixture;
  }

  const short = statusShort(fixture);
  if (!isOfficiallyFinal(short)) {
    return { match: base, enriched: false, conflicts: [] };
  }

  const nameOk = isExactOrderedPairByName(fixture, base.homeTeam, base.awayTeam);
  const homeOk =
    base.homeApiTeamId == null || fixture.teams.home.id === base.homeApiTeamId;
  const awayOk =
    base.awayApiTeamId == null || fixture.teams.away.id === base.awayApiTeamId;
  if ((!homeOk || !awayOk) && !nameOk) {
    return { match: base, enriched: false, conflicts: [] };
  }

  const details = await fetchApiMatchDetails(fixture, base);
  const { merged, conflicts } = fillMatchFromFixture(
    base,
    fixture,
    details.stats,
    opts?.overwrite ?? false,
    { events: details.events, lineups: details.lineups }
  );
  return { match: merged, enriched: true, conflicts };
}

export type TraceMatchResult = {
  match: LogMatch;
  filled: boolean;
  conflicts: ApiFieldConflict[];
  state: ResultTraceState;
};

/**
 * Trace one match by ordered saved home/away names.
 * When apiFixtureId is already known, prefer by-id status check.
 */
export async function traceMatchResult(
  match: LogMatch,
  batch: PredictionBatch,
  opts?: { overwrite?: boolean }
): Promise<TraceMatchResult> {
  const base = migrateMatchTraceState(match);
  if (base.resultFilled || base.resultTraceState === "FILLED") {
    return {
      match: base,
      filled: false,
      conflicts: [],
      state: "FILLED",
    };
  }
  if (base.resultSource === "manual") {
    const hg = base.teamStats?.home?.goals;
    const ag = base.teamStats?.away?.goals;
    if (hg != null && ag != null) {
      return {
        match: {
          ...base,
          resultFilled: true,
          resultTraceState: "FILLED",
        },
        filled: false,
        conflicts: [],
        state: "FILLED",
      };
    }
  }

  // Fast path: known fixture id
  if (base.apiFixtureId != null) {
    const fixture = await fetchFixtureByIdCached(base.apiFixtureId);
    await sleep(80);
    if (!fixture) {
      const updated = applyTraceMetadata(base, {
        kind: "metadata",
        state: "RETRY",
        note: "Stored fixture id not found; will retry name-pair search",
      });
      // Clear bad id and fall through to name search on next run — but try name now
      return await traceByNamePair(
        { ...updated, apiFixtureId: undefined },
        batch,
        opts
      );
    }
    const short = statusShort(fixture);
    // Verify ordered pair still matches saved names (IDs if present)
    const homeOk =
      base.homeApiTeamId == null ||
      fixture.teams.home.id === base.homeApiTeamId;
    const awayOk =
      base.awayApiTeamId == null ||
      fixture.teams.away.id === base.awayApiTeamId;
    const nameOk = isExactOrderedPairByName(
      fixture,
      base.homeTeam,
      base.awayTeam
    );
    if ((!homeOk || !awayOk) && !nameOk) {
      return {
        match: applyTraceMetadata(base, {
          kind: "metadata",
          state: "NEEDS_REVIEW",
          note: "Stored fixture no longer matches saved home–away order",
        }),
        filled: false,
        conflicts: [],
        state: "NEEDS_REVIEW",
      };
    }
    if (isAbandonedStatus(short)) {
      const updated = applyTraceMetadata(base, {
        kind: "metadata",
        fixture,
        state: "NEEDS_REVIEW",
        note: `Fixture status ${short} — not a normal completed result`,
      });
      return {
        match: updated,
        filled: false,
        conflicts: [],
        state: "NEEDS_REVIEW",
      };
    }
    if (!isOfficiallyFinal(short)) {
      const updated = applyTraceMetadata(base, {
        kind: "metadata",
        fixture,
        state: "FOUND_NOT_FINAL",
        note: "Match found — awaiting final result",
      });
      return {
        match: updated,
        filled: false,
        conflicts: [],
        state: "FOUND_NOT_FINAL",
      };
    }
    let stats: ApiFootballStatBlock[] | null = null;
    let enrichment: Pick<ApiMatchDetails, "events" | "lineups"> | undefined;
    {
      const details = await fetchApiMatchDetails(fixture, base, { full: true });
      stats = details.stats;
      enrichment = { events: details.events, lineups: details.lineups };
    }
    const { merged, conflicts } = fillMatchFromFixture(
      base,
      fixture,
      stats,
      opts?.overwrite ?? false,
      enrichment
    );
    return { match: merged, filled: true, conflicts, state: "FILLED" };
  }

  return traceByNamePair(base, batch, opts);
}

async function traceByNamePair(
  match: LogMatch,
  batch: PredictionBatch,
  opts?: { overwrite?: boolean }
): Promise<TraceMatchResult> {
  const league = matchLeague(match, batch.league);
  const resolved = await resolveOrderedTeamIds({
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    league,
  });

  if (!resolved.ok) {
    const state: ResultTraceState = resolved.ambiguous
      ? "NEEDS_REVIEW"
      : "RETRY";
    const updated = applyTraceMetadata(
      match,
      {
        kind: "metadata",
        state,
        note: resolved.note,
      },
      undefined
    );
    return { match: updated, filled: false, conflicts: [], state };
  }

  const seasons = [resolved.season, resolved.season - 1];
  const raw = await searchFixturesByOrderedPair({
    homeId: resolved.homeId,
    awayId: resolved.awayId,
    leagueId: resolved.leagueId,
    seasons,
  });
  const candidates = filterRelevantFixtures(
    raw,
    resolved.homeId,
    resolved.awayId,
    kickoffFloorMs(batch)
  );
  const decision = chooseFixtureForTrace(candidates);

  if (decision.kind === "metadata") {
    return {
      match: applyTraceMetadata(match, decision, {
        homeName: resolved.homeName,
        awayName: resolved.awayName,
      }),
      filled: false,
      conflicts: [],
      state: decision.state,
    };
  }

  let stats: ApiFootballStatBlock[] | null = null;
  let enrichment: Pick<ApiMatchDetails, "events" | "lineups"> | undefined;
  {
    const details = await fetchApiMatchDetails(decision.fixture, match, {
      full: true,
    });
    stats = details.stats;
    enrichment = { events: details.events, lineups: details.lineups };
  }
  const { merged, conflicts } = fillMatchFromFixture(
    match,
    decision.fixture,
    stats,
    opts?.overwrite ?? false,
    enrichment
  );
  return {
    match: {
      ...merged,
      resolvedHomeTeamName: resolved.homeName,
      resolvedAwayTeamName: resolved.awayName,
    },
    filled: true,
    conflicts,
    state: "FILLED",
  };
}

export type TracePendingSummary = {
  updatedBatches: number;
  matchesSynced: number;
  matchesNotFound: number;
  errors: string[];
  conflicts: ApiFieldConflict[];
  unavailable?: boolean;
  trace: TraceStatusCounts;
};

export async function tracePendingMatchResults(opts?: {
  batchId?: string;
}): Promise<TracePendingSummary> {
  const summary: TracePendingSummary = {
    updatedBatches: 0,
    matchesSynced: 0,
    matchesNotFound: 0,
    errors: [],
    conflicts: [],
    trace: emptyTraceCounts(),
  };

  let batches: PredictionBatch[];
  try {
    batches = await loadAllBatches();
  } catch (e) {
    summary.errors.push(e instanceof Error ? e.message : String(e));
    summary.unavailable = true;
    return summary;
  }

  if (opts?.batchId) {
    batches = batches.filter((b) => b.id === opts.batchId);
    if (!batches.length) {
      summary.errors.push(`Batch not found: ${opts.batchId}`);
      return summary;
    }
  }

  const pendingBatches = batches.filter(
    (b) => batchNeedsResults(b) || b.matches.some(matchNeedsNamePairTrace)
  );

  const { bridgeTraceMatchResultSafe } = await import(
    "@/lib/core/result-trace-bridge"
  );

  for (const batch of pendingBatches) {
    let batchChanged = false;
    const updatedMatches: LogMatch[] = [];

    for (const match of batch.matches) {
      const migrated = migrateMatchTraceState(match);
      if (!matchNeedsNamePairTrace(migrated)) {
        accumulateTraceState(summary.trace, migrated.resultTraceState);
        updatedMatches.push(migrated);
        continue;
      }

      let traced: TraceMatchResult;
      try {
        traced = await traceMatchResult(migrated, batch);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        summary.errors.push(`${batch.batchName}: ${msg}`);
        if (isApiFootballKeyError(msg) || /rate|limit|quota/i.test(msg)) {
          summary.unavailable = true;
        }
        accumulateTraceState(summary.trace, migrated.resultTraceState);
        updatedMatches.push(migrated);
        continue;
      }

      if (traced.conflicts.length) summary.conflicts.push(...traced.conflicts);
      if (traced.filled) {
        summary.matchesSynced++;
        batchChanged = true;
      } else if (
        traced.state === "RETRY" &&
        traced.match.resultTraceState !== migrated.resultTraceState
      ) {
        summary.matchesNotFound++;
        batchChanged = true;
      } else if (
        JSON.stringify(traced.match) !== JSON.stringify(migrated)
      ) {
        batchChanged = true;
        if (traced.state === "RETRY") summary.matchesNotFound++;
      }

      accumulateTraceState(summary.trace, traced.state);
      updatedMatches.push(traced.match);

      // Additive provenance only — never changes KV settlement path.
      await bridgeTraceMatchResultSafe(batch, traced.match, traced.state);
    }

    if (!batchChanged) continue;

    let updatedBatch: PredictionBatch = scoreBatch({
      ...batch,
      matches: updatedMatches,
    });
    const entered = marketsEnteredCount(updatedBatch);
    if (entered.total > 0 && entered.scored === entered.total) {
      updatedBatch = {
        ...updatedBatch,
        recommendationStatus:
          updatedBatch.batchKind === "recommended"
            ? "SETTLED"
            : updatedBatch.recommendationStatus,
        settledAt:
          updatedBatch.batchKind === "recommended"
            ? new Date().toISOString()
            : updatedBatch.settledAt,
      };
    }

    try {
      const allBatches = await loadAllBatches();
      const leagueBaselines = computeLeagueBaselines(allBatches);
      const teamsQuality = await loadTeamsQualityStore().catch(() => null);
      const synced = await syncBatchToClubHistories(updatedBatch, {
        leagueBaselines,
        teamsQuality,
      });
      await saveBatch(synced);
      await maybeRetrainOnBatchResult(synced).catch(() => null);
      await maybeBayesianCalibrateOnBatch(synced).catch(() => null);
      summary.updatedBatches++;
    } catch (e) {
      summary.errors.push(
        `Failed to save ${batch.batchName}: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
  }

  if (summary.updatedBatches > 0) {
    await recomputeAndPersistLearnerStats().catch(() => null);
    await recomputeAndPersistLeaguePriors().catch(() => null);
    await recomputePlSeasonCards().catch(() => null);
    await recomputeLlSeasonCards().catch(() => null);
    await recomputeBlSeasonCards().catch(() => null);
    await recomputeSaSeasonCards().catch(() => null);
    await recomputeL1SeasonCards().catch(() => null);
  }

  return summary;
}
