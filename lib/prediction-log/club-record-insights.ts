import { findClubInIndex } from "./club-index";
import { compareClubs, compareMatchup, type ComparisonResult } from "./club-comparison";
import {
  buildClubInsightParagraph,
  CLUB_WEAK_MARKET_THRESHOLD,
  getClubMarketHitRate,
  isClubWeakOnMarket,
  MIN_CLUB_PROFILE_FILTER,
  MIN_CLUB_PROFILE_SAMPLE,
} from "./club-profile-insights";
import type { ClubIndex, ClubRecord, HistoryTypeKey } from "./club-record-types";
import type { RecommendationContext } from "./recommendation-context";
import type { ScoredMatchCandidate } from "./match-risk-score";
import type { ClubProfilesStore, LogMarketKey, LogMatch, PredictionBatch } from "./types";

export function marketToHistoryType(market: LogMarketKey): HistoryTypeKey | null {
  switch (market) {
    case "1x2":
    case "ht_1x2":
    case "win_one_half":
    case "double_chance":
      return "winLose";
    case "btts":
      return "bothTeamsScore";
    case "sot_ou":
    case "home_sot_ou":
    case "away_sot_ou":
      return "shotsOnTarget";
    case "shots_ou":
    case "home_shots_ou":
    case "away_shots_ou":
      return "totalShots";
    case "corners_ou":
      return "corners";
    case "offsides_ou":
      return "offsides";
    case "home_goals_ou":
    case "away_goals_ou":
    case "more_goals_half":
    case "draw_one_half":
      return "overUnder";
    default:
      return null;
  }
}

export function resolveClubRecord(
  ctx: RecommendationContext,
  clubName: string,
  clubId?: string
): ClubRecord | null {
  if (clubId && ctx.clubRecords?.[clubId]) return ctx.clubRecords[clubId];
  if (!ctx.clubRecords || !ctx.clubIndex) return null;
  const entry = findClubInIndex(ctx.clubIndex, clubName, ctx.league);
  if (!entry) return null;
  return ctx.clubRecords[entry.clubId] ?? null;
}

export function getClubCapacityHitRate(
  record: ClubRecord | null,
  market: LogMarketKey,
  _venue: "home" | "away"
): { pct: number | null; sample: number; lowSample: boolean } {
  if (!record) return { pct: null, sample: 0, lowSample: true };
  const type = marketToHistoryType(market);
  const cap = record.capacity;
  if (!type) {
    return {
      pct: cap.winRate,
      sample: cap.sampleSize,
      lowSample: cap.sampleSize < MIN_CLUB_PROFILE_SAMPLE,
    };
  }
  const pct = cap.predictionAccuracyByType[type] ?? null;
  return {
    pct,
    sample: cap.sampleSize,
    lowSample: cap.lowSample || cap.sampleSize < MIN_CLUB_PROFILE_SAMPLE,
  };
}

export function getClubMarketHitRateFromContext(
  ctx: RecommendationContext,
  clubName: string,
  market: LogMarketKey,
  venue: "home" | "away",
  clubId?: string
): { pct: number | null; sample: number; lowSample: boolean } {
  const record = resolveClubRecord(ctx, clubName, clubId);
  if (record) return getClubCapacityHitRate(record, market, venue);
  return getClubMarketHitRate(ctx.clubProfiles, ctx.league, clubName, market, venue);
}

export function getClubComparisonRate(
  ctx: RecommendationContext,
  match: LogMatch,
  market: LogMarketKey
): { pct: number | null; sample: number; lowSample: boolean } {
  const home = resolveClubRecord(ctx, match.homeTeam, match.homeClubId);
  const away = resolveClubRecord(ctx, match.awayTeam, match.awayClubId);
  if (!home || !away) {
    const homeRate = getClubMarketHitRateFromContext(
      ctx,
      match.homeTeam,
      market,
      "home",
      match.homeClubId
    );
    const awayRate = getClubMarketHitRateFromContext(
      ctx,
      match.awayTeam,
      market,
      "away",
      match.awayClubId
    );
    const parts = [homeRate, awayRate].filter((r) => !r.lowSample && r.pct != null);
    if (parts.length === 0) return { pct: null, sample: 0, lowSample: true };
    return {
      pct: Math.round(parts.reduce((s, r) => s + (r.pct ?? 0), 0) / parts.length),
      sample: parts.reduce((s, r) => s + r.sample, 0),
      lowSample: false,
    };
  }
  const type = marketToHistoryType(market) ?? "winLose";
  const cmp = compareClubs(home, away, "home", type);
  return {
    pct: cmp.confidence,
    sample: Math.min(home.capacity.sampleSize, away.capacity.sampleSize),
    lowSample: cmp.lowDataWarning,
  };
}

export function isClubWeakFromContext(
  ctx: RecommendationContext,
  clubName: string,
  market: LogMarketKey,
  venue: "home" | "away",
  clubId?: string
): { weak: boolean; reason: string | null } {
  const record = resolveClubRecord(ctx, clubName, clubId);
  if (record) {
    const rate = getClubCapacityHitRate(record, market, venue);
    if (
      !rate.lowSample &&
      rate.pct != null &&
      record.capacity.sampleSize >= MIN_CLUB_PROFILE_FILTER &&
      rate.pct < CLUB_WEAK_MARKET_THRESHOLD
    ) {
      return {
        weak: true,
        reason: `${clubName} capacity shows ${rate.pct}% on ${market} (${record.capacity.sampleSize} samples).`,
      };
    }
    return { weak: false, reason: null };
  }
  return isClubWeakOnMarket(ctx.clubProfiles, ctx.league, clubName, market, venue);
}

export function buildClubComparisonParagraph(
  ctx: RecommendationContext,
  selected: ScoredMatchCandidate[]
): string | undefined {
  if (selected.length === 0) return undefined;

  const notes: string[] = [];
  for (const leg of selected) {
    const home = resolveClubRecord(ctx, leg.homeTeam);
    const away = resolveClubRecord(ctx, leg.awayTeam);
    if (home && away) {
      const type = marketToHistoryType(leg.marketKey) ?? "winLose";
      const cmp = compareClubs(home, away, "home", type);
      notes.push(
        `${leg.homeTeam} vs ${leg.awayTeam}: ${cmp.judgement.slice(0, 80)} (${cmp.confidence}% conf)`
      );
    }
  }

  if (notes.length > 0) {
    return `Club comparison: ${notes.slice(0, 4).join(" ")}`;
  }

  return buildClubInsightParagraph(ctx.clubProfiles, ctx.league, selected);
}

export function buildMatchH2HComparison(
  ctx: RecommendationContext,
  match: LogMatch
): ComparisonResult | null {
  const home = resolveClubRecord(ctx, match.homeTeam, match.homeClubId);
  const away = resolveClubRecord(ctx, match.awayTeam, match.awayClubId);
  if (!home || !away) return null;
  return compareMatchup(home, away, "home");
}

export async function loadClubRecordsForBatch(
  batch: PredictionBatch,
  clubIndex: ClubIndex | null,
  fetchRecord: (id: string) => Promise<ClubRecord | null>
): Promise<Record<string, ClubRecord>> {
  if (!clubIndex) return {};
  const ids = new Set<string>();
  for (const m of batch.matches) {
    if (m.homeClubId) ids.add(m.homeClubId);
    else {
      const e = findClubInIndex(clubIndex, m.homeTeam, batch.league);
      if (e) ids.add(e.clubId);
    }
    if (m.awayClubId) ids.add(m.awayClubId);
    else {
      const e = findClubInIndex(clubIndex, m.awayTeam, batch.league);
      if (e) ids.add(e.clubId);
    }
  }
  const records: Record<string, ClubRecord> = {};
  await Promise.all(
    [...ids].map(async (id) => {
      const r = await fetchRecord(id);
      if (r) records[id] = r;
    })
  );
  return records;
}
