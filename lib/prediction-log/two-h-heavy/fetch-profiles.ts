/**
 * Fetch + cache venue half profiles from API-Football.
 * Primary: score.halftime + FT from /fixtures (paid plan).
 * Seeds/DB only when n < MIN_MATCHES at resolve time.
 * Never called from page render.
 */
import { standardizeTeamName } from "@/lib/data/team-names";
import { getJson, setJsonEx } from "@/lib/prediction-log/kv";
import { KV_KEYS } from "@/lib/prediction-log/kv-keys";
import { apiFootballGet, sleep } from "@/lib/football-api/client";
import { apiLeagueId, apiSeasonFromDate } from "@/lib/football-api/leagues";
import type { ApiFootballFixture } from "@/lib/football-api/map-fixture-to-match";
import {
  loadTeamIdMap,
  lookupTeamIdInMap,
  resolveApiTeamId,
  teamNameKey,
} from "@/lib/football-api/team-id-map";
import type { CachedTeamHalfProfile, VenueSide } from "./types";

const PROFILE_TTL_SECONDS = 18 * 60 * 60;
const FINISHED = new Set(["FT", "AET", "PEN"]);
const LAST_N = 12;

function isFinished(f: ApiFootballFixture): boolean {
  const short = (f.fixture?.status?.short ?? "").toUpperCase();
  return FINISHED.has(short);
}

function fixtureDate(f: ApiFootballFixture): string {
  return (f.fixture?.date ?? "").slice(0, 10);
}

function averagesFromFixtures(
  fixtures: ApiFootballFixture[],
  teamId: number,
  venue: VenueSide
): Omit<
  CachedTeamHalfProfile,
  "teamId" | "teamName" | "leagueId" | "venue" | "formation" | "updatedAt"
> | null {
  let n = 0;
  let sc1 = 0;
  let sc2 = 0;
  let conc1 = 0;
  let conc2 = 0;
  let last: string | null = null;

  for (const f of fixtures) {
    if (!isFinished(f)) continue;
    const homeId = f.teams?.home?.id;
    const awayId = f.teams?.away?.id;
    const isHome = homeId === teamId;
    const isAway = awayId === teamId;
    if (venue === "home" && !isHome) continue;
    if (venue === "away" && !isAway) continue;

    const htH = f.score?.halftime?.home;
    const htA = f.score?.halftime?.away;
    const ftH = f.goals?.home;
    const ftA = f.goals?.away;
    if (
      htH == null ||
      htA == null ||
      ftH == null ||
      ftA == null ||
      !Number.isFinite(htH) ||
      !Number.isFinite(htA) ||
      !Number.isFinite(ftH) ||
      !Number.isFinite(ftA)
    ) {
      continue;
    }

    if (isHome) {
      sc1 += htH;
      sc2 += Math.max(0, ftH - htH);
      conc1 += htA;
      conc2 += Math.max(0, ftA - htA);
    } else {
      sc1 += htA;
      sc2 += Math.max(0, ftA - htA);
      conc1 += htH;
      conc2 += Math.max(0, ftH - htH);
    }
    n += 1;
    const d = fixtureDate(f);
    if (d && (!last || d > last)) last = d;
  }

  if (n === 0) return null;
  return {
    sc_1h: sc1 / n,
    sc_2h: sc2 / n,
    conc_1h: conc1 / n,
    conc_2h: conc2 / n,
    n_matches: n,
    last_match_date: last,
  };
}

function clientProfileKey(team: string, venue: VenueSide): string {
  return `${standardizeTeamName(team).trim().toLowerCase()}|${venue}`;
}

export async function loadCachedTeamHalfProfile(
  leagueId: number,
  teamId: number,
  venue: VenueSide
): Promise<CachedTeamHalfProfile | null> {
  return getJson<CachedTeamHalfProfile>(KV_KEYS.teamHalfProfile(leagueId, teamId, venue));
}

export async function saveCachedTeamHalfProfile(
  profile: CachedTeamHalfProfile
): Promise<void> {
  await setJsonEx(
    KV_KEYS.teamHalfProfile(profile.leagueId, profile.teamId, profile.venue),
    profile,
    PROFILE_TTL_SECONDS
  );
  // Name alias for read-only client lookups (no AF needed).
  await setJsonEx(
    KV_KEYS.teamHalfProfileByName(
      profile.leagueId,
      teamNameKey(profile.teamName),
      profile.venue
    ),
    profile,
    PROFILE_TTL_SECONDS
  );
}

/** Best-effort fetch for one team+venue; returns null on any failure. */
export async function refreshTeamHalfProfile(opts: {
  teamName: string;
  league: string;
  venue: VenueSide;
  season?: number;
}): Promise<CachedTeamHalfProfile | null> {
  const leagueId = apiLeagueId(opts.league);
  if (leagueId == null) return null;

  const season =
    opts.season ?? apiSeasonFromDate(new Date().toISOString().slice(0, 10));

  try {
    const resolved = await resolveApiTeamId({
      teamName: opts.teamName,
      league: opts.league,
      season,
    });
    if (resolved.teamId == null || resolved.leagueId == null) return null;

    const fixtures = await apiFootballGet<ApiFootballFixture[]>("/fixtures", {
      team: resolved.teamId,
      league: resolved.leagueId,
      season,
      last: LAST_N,
    });

    const avgs = averagesFromFixtures(fixtures ?? [], resolved.teamId, opts.venue);
    if (!avgs) return null;

    const profile: CachedTeamHalfProfile = {
      teamId: resolved.teamId,
      teamName: standardizeTeamName(opts.teamName),
      leagueId: resolved.leagueId,
      venue: opts.venue,
      ...avgs,
      formation: null,
      updatedAt: new Date().toISOString(),
    };
    await saveCachedTeamHalfProfile(profile);
    return profile;
  } catch {
    return null;
  }
}

export interface TeamVenueRequest {
  team: string;
  league: string;
  venue: VenueSide;
}

/**
 * Read-only: load cached profiles for team/venue pairs.
 * Never calls API-Football — only KV + existing team-id map.
 */
export async function readCachedProfilesForTeams(
  requests: TeamVenueRequest[]
): Promise<Record<string, CachedTeamHalfProfile>> {
  const out: Record<string, CachedTeamHalfProfile> = {};
  const season = apiSeasonFromDate(new Date().toISOString().slice(0, 10));

  for (const req of requests) {
    const leagueId = apiLeagueId(req.league);
    if (leagueId == null) continue;
    const key = clientProfileKey(req.team, req.venue);

    // Prefer name alias (no map needed).
    const byName = await getJson<CachedTeamHalfProfile>(
      KV_KEYS.teamHalfProfileByName(leagueId, teamNameKey(req.team), req.venue)
    );
    if (byName) {
      out[key] = byName;
      continue;
    }

    // Fall back to id-keyed cache via already-warmed team map (no AF refresh).
    try {
      const map = await loadTeamIdMap(leagueId, season);
      if (!map) continue;
      const hit = lookupTeamIdInMap(map, req.team);
      if (hit.teamId == null) continue;
      const cached = await loadCachedTeamHalfProfile(leagueId, hit.teamId, req.venue);
      if (cached) out[key] = cached;
    } catch {
      /* skip */
    }
  }
  return out;
}

/**
 * Warm cache for unique team/venue pairs from a batch list (best-effort, rate-limited).
 */
export async function warmTeamHalfProfiles(
  requests: TeamVenueRequest[],
  opts?: { maxCalls?: number; delayMs?: number }
): Promise<{ refreshed: number; failed: number }> {
  const maxCalls = opts?.maxCalls ?? 20;
  const delayMs = opts?.delayMs ?? 350;
  const seen = new Set<string>();
  let refreshed = 0;
  let failed = 0;
  let calls = 0;

  for (const req of requests) {
    const dedupe = `${req.league}|${req.team.toLowerCase()}|${req.venue}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    if (calls >= maxCalls) break;
    calls += 1;
    const hit = await refreshTeamHalfProfile({
      teamName: req.team,
      league: req.league,
      venue: req.venue,
    });
    if (hit) refreshed += 1;
    else failed += 1;
    if (delayMs > 0) await sleep(delayMs);
  }
  return { refreshed, failed };
}
