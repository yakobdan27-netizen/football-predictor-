import {
  clubProfileId,
  getClubProfile,
} from "./club-profiles";
import type { LogMarketKey, LogMatch, HitStats, ClubProfilesStore } from "./types";
import type { ScoredMatchCandidate } from "./match-risk-score";

export const MIN_CLUB_PROFILE_SAMPLE = 3;
export const MIN_CLUB_PROFILE_FILTER = 4;
export const CLUB_WEAK_MARKET_THRESHOLD = 38;

function marketMetricKey(
  market: LogMarketKey
): keyof import("./types").ClubProfileMetrics | "numeric" | null {
  switch (market) {
    case "1x2":
    case "ht_1x2":
      return "result1x2";
    case "double_chance":
      return "doubleChance";
    case "btts":
      return "btts";
    case "home_goals_ou":
    case "away_goals_ou":
      return "overUnderGoals";
    case "more_goals_half":
    case "draw_one_half":
    case "win_one_half":
      return "firstHalfSecondHalf";
    case "shots_ou":
    case "home_shots_ou":
    case "away_shots_ou":
    case "sot_ou":
    case "corners_ou":
      return "numeric";
    default:
      return null;
  }
}

function numericMetricKey(
  market: LogMarketKey
): keyof import("./types").ClubProfileMetrics["numericLines"] | null {
  if (market === "shots_ou" || market === "home_shots_ou" || market === "away_shots_ou") return "shots";
  if (market === "sot_ou") return "sot";
  if (market === "corners_ou") return "corners";
  return null;
}

function pickStats(
  profile: import("./types").ClubProfile,
  market: LogMarketKey,
  venue: "home" | "away"
): HitStats | null {
  const useWeighted = profile.weightedMetrics;
  const bucket = marketMetricKey(market);
  if (bucket === "numeric") {
    const nk = numericMetricKey(market);
    if (!nk) return null;
    return useWeighted.numericLines[nk];
  }
  if (!bucket) return null;

  const marketStats = useWeighted[bucket] as HitStats;

  const venueStats = venue === "home" ? useWeighted.homeRecord : useWeighted.awayRecord;
  if (marketStats.sample >= MIN_CLUB_PROFILE_SAMPLE && venueStats.sample >= MIN_CLUB_PROFILE_SAMPLE) {
    const blendedPct =
      marketStats.pct != null && venueStats.pct != null
        ? Math.round((marketStats.pct * 0.6 + venueStats.pct * 0.4))
        : marketStats.pct ?? venueStats.pct;
    return {
      ...marketStats,
      pct: blendedPct,
      sample: Math.min(marketStats.sample, venueStats.sample),
    };
  }
  return marketStats.sample >= MIN_CLUB_PROFILE_SAMPLE ? marketStats : null;
}

export function getClubMarketHitRate(
  store: ClubProfilesStore | null | undefined,
  league: string,
  clubName: string,
  market: LogMarketKey,
  venue: "home" | "away"
): { pct: number | null; sample: number; lowSample: boolean } {
  const profile = getClubProfile(store, league, clubName);
  if (!profile) return { pct: null, sample: 0, lowSample: true };
  const stats = pickStats(profile, market, venue);
  if (!stats || stats.sample < MIN_CLUB_PROFILE_SAMPLE) {
    return { pct: null, sample: stats?.sample ?? 0, lowSample: true };
  }
  return { pct: stats.pct, sample: stats.sample, lowSample: false };
}

export function isClubWeakOnMarket(
  store: ClubProfilesStore | null | undefined,
  league: string,
  clubName: string,
  market: LogMarketKey,
  venue: "home" | "away"
): { weak: boolean; reason: string | null } {
  const rate = getClubMarketHitRate(store, league, clubName, market, venue);
  if (rate.lowSample || rate.pct == null || rate.sample < MIN_CLUB_PROFILE_FILTER) {
    return { weak: false, reason: null };
  }
  if (rate.pct < CLUB_WEAK_MARKET_THRESHOLD) {
    return {
      weak: true,
      reason: `${clubName} profile shows ${rate.pct}% on ${market} (${rate.sample} picks).`,
    };
  }
  return { weak: false, reason: null };
}

export function buildClubInsightParagraph(
  store: ClubProfilesStore | null | undefined,
  league: string,
  selected: ScoredMatchCandidate[]
): string | undefined {
  if (!store || selected.length === 0) return undefined;

  const notes: string[] = [];
  const seen = new Set<string>();

  for (const leg of selected) {
    for (const [club, venue] of [
      [leg.homeTeam, "home"] as const,
      [leg.awayTeam, "away"] as const,
    ]) {
      const key = clubProfileId(league, club);
      if (seen.has(key)) continue;
      seen.add(key);
      const profile = getClubProfile(store, league, club);
      if (!profile || profile.tags.length === 0) continue;
      const rate = getClubMarketHitRate(store, league, club, leg.marketKey, venue);
      const tagSnippet = profile.tags.slice(0, 2).join(", ");
      if (rate.pct != null && rate.sample >= MIN_CLUB_PROFILE_SAMPLE) {
        notes.push(
          `${club} (${venue}): ${tagSnippet} — ${leg.marketKey} ${rate.pct}% in your history.`
        );
      } else {
        notes.push(`${club}: ${tagSnippet}.`);
      }
    }
  }

  if (notes.length === 0) return undefined;
  return `Club insights: ${notes.slice(0, 4).join(" ")}`;
}

export function buildMatchClubInsight(
  store: ClubProfilesStore | null | undefined,
  league: string,
  match: LogMatch,
  market: LogMarketKey
): string | null {
  const home = getClubProfile(store, league, match.homeTeam);
  const away = getClubProfile(store, league, match.awayTeam);
  const parts: string[] = [];
  if (home?.tags.length) parts.push(`${match.homeTeam} (${home.tags.slice(0, 2).join(", ")})`);
  if (away?.tags.length) parts.push(`${match.awayTeam} (${away.tags.slice(0, 2).join(", ")})`);
  if (parts.length === 0) return null;
  const homeRate = getClubMarketHitRate(store, league, match.homeTeam, market, "home");
  const awayRate = getClubMarketHitRate(store, league, match.awayTeam, market, "away");
  let detail = "";
  if (homeRate.pct != null && homeRate.sample >= MIN_CLUB_PROFILE_SAMPLE) {
    detail += ` Home club ${market} ${homeRate.pct}%.`;
  }
  if (awayRate.pct != null && awayRate.sample >= MIN_CLUB_PROFILE_SAMPLE) {
    detail += ` Away club ${market} ${awayRate.pct}%.`;
  }
  return `${parts.join(" vs ")}.${detail}`.trim();
}
