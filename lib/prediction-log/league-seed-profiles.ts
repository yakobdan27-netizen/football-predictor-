/**
 * Cold-start League Analysis profiles from 2021/22–2025/26 seed JSON
 * (half-goals + corners). Live batch results override when available.
 */
import { poissonPmf } from "@/lib/predictor/poisson";
import { allHalfGoalsBaselines, lookupLeagueHalfBaseline } from "./half-goals-baselines";
import { allCornersBaselines } from "./corners-baselines";
import {
  confidenceLevel,
  emptyLeagueCharacterProfile,
} from "./league-profiles";
import { leagueMetaForName, resolveLeagueId } from "./league-registry";
import { leagueProfileKey } from "./season";
import type {
  League,
  LeagueCharacterProfile,
  LeagueCharacterTrait,
  LeagueProfilesStore,
} from "./types";
import { LEAGUE_PROFILE_SCHEMA_VERSION } from "./types";

const SEED_LEAGUES = ["Premier League", "La Liga", "Serie A", "Ligue 1"] as const;
const SEED_SEASONS = ["2021/22", "2022/23", "2023/24", "2024/25", "2025/26"] as const;
const LIVE_OVERRIDE_MIN = 5;

function trait(value: number | null, sampleSize: number): LeagueCharacterTrait {
  return { value, baselineDelta: null, sampleSize };
}

function poissonOver25(meanGoals: number): number {
  const lam = Math.max(0.2, meanGoals);
  const pUnder =
    poissonPmf(0, lam) + poissonPmf(1, lam) + poissonPmf(2, lam);
  return Math.round((1 - pUnder) * 1000) / 10;
}

function leagueCornersAvg(league: string, season: string): number | null {
  const rows = allCornersBaselines().filter(
    (r) => r.league === league && r.season === season
  );
  if (rows.length === 0) return null;
  const avg =
    rows.reduce((s, r) => s + r.avgCornersWon + r.avgCornersConceded, 0) / rows.length;
  return Math.round(avg * 100) / 100;
}

function seasonMatchWeight(league: string, season: string): number {
  const rows = allHalfGoalsBaselines().filter(
    (r) => r.league === league && r.season === season
  );
  if (rows.length === 0) return 0;
  return Math.round(rows.reduce((s, r) => s + r.matchesAnalyzed, 0) / Math.max(1, rows.length));
}

/** Build a character profile from seed baselines for one league×season. */
export function buildSeedCharacterProfile(
  leagueName: string,
  season: string
): { profile: LeagueCharacterProfile; sampleSize: number } | null {
  const half = lookupLeagueHalfBaseline(leagueName, season);
  if (!half || half.season !== season) {
    // lookupLeagueHalfBaseline falls back across seasons — require exact season match via raw rows
    const rows = allHalfGoalsBaselines().filter(
      (r) => r.league === leagueName && r.season === season
    );
    if (rows.length === 0) return null;
    const avg1h = rows.reduce((a, r) => a + r.avg1h, 0) / rows.length;
    const avg2h = rows.reduce((a, r) => a + r.avg2h, 0) / rows.length;
    const avgGoals = rows.reduce((a, r) => a + r.avgGoals, 0) / rows.length;
    return profileFromAvgs(avg1h, avg2h, avgGoals, leagueName, season, rows.length);
  }

  const rows = allHalfGoalsBaselines().filter(
    (r) => r.league === leagueName && r.season === season
  );
  if (rows.length === 0) return null;
  return profileFromAvgs(
    half.avg1h,
    half.avg2h,
    half.avgGoals,
    leagueName,
    season,
    rows.length
  );
}

function profileFromAvgs(
  avg1h: number,
  avg2h: number,
  avgGoals: number,
  leagueName: string,
  season: string,
  clubCount: number
): { profile: LeagueCharacterProfile; sampleSize: number } {
  const sample = Math.max(clubCount, seasonMatchWeight(leagueName, season));
  const corners = leagueCornersAvg(leagueName, season);
  const profile = emptyLeagueCharacterProfile();
  profile.first_half_goals_avg = trait(Math.round(avg1h * 100) / 100, sample);
  profile.second_half_goals_avg = trait(Math.round(avg2h * 100) / 100, sample);
  profile.half_dominance = trait(
    avg1h > 0 ? Math.round((avg2h / avg1h) * 100) / 100 : null,
    sample
  );
  profile.goals_per_match_avg = trait(Math.round(avgGoals * 100) / 100, sample);
  profile.over_2_5_rate = trait(poissonOver25(avgGoals), sample);
  profile.corners_per_match_avg = trait(corners, sample);
  profile.home_advantage_index = trait(1.1, sample);
  profile.tempo_index = trait(Math.round(avgGoals * 100) / 100, sample);
  // Rough BTTS prior from scoring volume (not match-level truth)
  const bttsApprox = Math.min(75, Math.max(35, Math.round((avgGoals / 2.7) * 52)));
  profile.btts_rate = trait(bttsApprox, sample);
  return { profile, sampleSize: sample };
}

export function buildAllSeedLeagueProfiles(): Record<string, League> {
  const out: Record<string, League> = {};
  const now = new Date().toISOString();
  for (const leagueName of SEED_LEAGUES) {
    const meta = leagueMetaForName(leagueName);
    for (const season of SEED_SEASONS) {
      const built = buildSeedCharacterProfile(leagueName, season);
      if (!built) continue;
      const key = leagueProfileKey(meta.leagueId, season);
      out[key] = {
        leagueId: meta.leagueId,
        leagueName: meta.leagueName,
        country: meta.country,
        season,
        matchesLogged: built.sampleSize,
        characterProfile: built.profile,
        confidenceLevel: confidenceLevel(built.sampleSize),
        lastUpdated: now,
        dataSource: "seed",
      };
    }
  }
  return out;
}

function preferTrait(
  live: LeagueCharacterTrait,
  seed: LeagueCharacterTrait
): LeagueCharacterTrait {
  if (live.manual) return live;
  if (live.value != null && live.sampleSize >= LIVE_OVERRIDE_MIN) return live;
  if (seed.value != null) {
    return {
      ...seed,
      baselineDelta: live.baselineDelta,
    };
  }
  return live;
}

/** Merge seed priors under live profiles; keep manual overrides. */
export function mergeSeedIntoLeagueProfiles(
  liveStore: LeagueProfilesStore
): LeagueProfilesStore {
  const seeds = buildAllSeedLeagueProfiles();
  const leagues: Record<string, League> = { ...seeds };

  for (const [key, live] of Object.entries(liveStore.leagues)) {
    const seed = seeds[key];
    if (!seed) {
      leagues[key] = { ...live, dataSource: live.dataSource ?? "live" };
      continue;
    }
    if (live.matchesLogged >= LIVE_OVERRIDE_MIN) {
      const profile = emptyLeagueCharacterProfile();
      for (const traitKey of Object.keys(profile) as Array<keyof LeagueCharacterProfile>) {
        if (traitKey === "goal_timing_curve") {
          profile.goal_timing_curve =
            live.characterProfile.goal_timing_curve.sampleSize > 0
              ? live.characterProfile.goal_timing_curve
              : seed.characterProfile.goal_timing_curve;
          continue;
        }
        profile[traitKey] = preferTrait(
          live.characterProfile[traitKey] as LeagueCharacterTrait,
          seed.characterProfile[traitKey] as LeagueCharacterTrait
        ) as never;
      }
      leagues[key] = {
        ...live,
        characterProfile: profile,
        dataSource: "blended",
      };
    } else {
      // Prefer seed when live sample is thin, but preserve manual traits
      const profile = { ...seed.characterProfile };
      const manual = liveStore.manualFields[key] ?? [];
      for (const path of manual) {
        const parts = path.split(".");
        if (parts.length === 2 && parts[0] === "characterProfile") {
          const traitKey = parts[1] as keyof LeagueCharacterProfile;
          if (traitKey === "goal_timing_curve") continue;
          profile[traitKey] = live.characterProfile[traitKey] as never;
        }
      }
      leagues[key] = {
        ...seed,
        characterProfile: profile,
        matchesLogged: Math.max(seed.matchesLogged, live.matchesLogged),
        dataSource: live.matchesLogged > 0 ? "blended" : "seed",
        lastUpdated: new Date().toISOString(),
      };
    }
  }

  return {
    schemaVersion: LEAGUE_PROFILE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    leagues,
    manualFields: liveStore.manualFields,
  };
}

export function seedLeagueNames(): string[] {
  return [...SEED_LEAGUES];
}

export function seedSeasons(): string[] {
  return [...SEED_SEASONS];
}

export function resolveLeagueNameFromId(leagueId: string): string | null {
  const hit = SEED_LEAGUES.find((n) => resolveLeagueId(n) === leagueId);
  return hit ?? null;
}
