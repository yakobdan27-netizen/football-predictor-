import type { Page } from "puppeteer-core";
import { resolveToAppTeam } from "@/lib/football-api/team-resolve";
import { LEAGUE_OPTIONS } from "@/lib/prediction-log/markets-config";
import { resolveLeagueId } from "@/lib/prediction-log/league-registry";
import { loadAllBatches, saveBatch } from "@/lib/prediction-log/club-store";
import { syncBatchToClubHistories } from "@/lib/prediction-log/club-history-writer";
import { maybeRetrainOnBatchResult } from "@/lib/prediction-log/retrain-ml";
import { maybeBayesianCalibrateOnBatch } from "@/lib/prediction-log/bayesian-calibration";
import { computeLeagueBaselines } from "@/lib/prediction-log/league-baselines";
import { loadTeamsQualityStore } from "@/lib/prediction-log/teams-quality-store";
import { applyTeamStatsSync } from "@/lib/prediction-log/team-stats-sync";
import { getJson, setJson } from "@/lib/prediction-log/kv";
import { KV_KEYS } from "@/lib/prediction-log/kv-keys";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";
import { closeBrowser, launchLivescoreBrowser } from "./browser";
import { getCachedScrape, setCachedScrape } from "./cache";
import { mapScrapeToMatchUpdates } from "./map-to-match";
import {
  buildStatsUrl,
  competitionHintMatch,
  type DateFeedStage,
} from "./resolve-match";
import { scrapeLivescoreStatsPage } from "./scrape-stats-page";
import {
  BULK_LAST_N,
  BULK_SEASON,
  buildExistingDedupeIndex,
  emptyBulkMatch,
  isDuplicateMatch,
  isFinishedStatus,
  isInSeasonWindow,
  lookbackDateKeys,
  matchDedupeKey,
  selectTopFinished,
  ymdToIso,
  type BulkDiscoveredMatch,
} from "./bulk-helpers";

const CDN = "https://prod-cdn-public-api.livescore.com/v1/api/app";
const DELAY_MS_MIN = 1200;
const DELAY_MS_MAX = 2200;

export interface BulkProgress {
  failedLeagues: string[];
  lastRunAt?: string;
  lastErrors?: string[];
}

export interface BulkHistorySummary {
  doneLeagues: string[];
  remainingLeagues: string[];
  scraped: number;
  skippedDuplicates: number;
  failed: number;
  errors: string[];
  batchIds: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function politeDelay(): Promise<void> {
  const ms = DELAY_MS_MIN + Math.floor(Math.random() * (DELAY_MS_MAX - DELAY_MS_MIN));
  return sleep(ms);
}

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function fetchJsonInPage<T>(page: Page, url: string): Promise<T | null> {
  try {
    return await page.evaluate(async (u) => {
      const res = await fetch(u, {
        headers: { Accept: "application/json" },
        credentials: "omit",
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    }, url);
  } catch {
    return null;
  }
}

export async function loadBulkProgress(): Promise<BulkProgress> {
  return (
    (await getJson<BulkProgress>(KV_KEYS.livescoreBulkProgress)) ?? {
      failedLeagues: [],
    }
  );
}

export async function saveBulkProgress(progress: BulkProgress): Promise<void> {
  await setJson(KV_KEYS.livescoreBulkProgress, progress);
}

/**
 * Discover up to last N finished matches for a league by walking recent date feeds.
 */
export async function discoverLastFinishedForLeague(
  page: Page,
  league: string,
  options?: { maxMatches?: number; fromDate?: Date }
): Promise<BulkDiscoveredMatch[]> {
  const maxMatches = options?.maxMatches ?? BULK_LAST_N;
  const from = options?.fromDate ?? new Date();
  const dateKeys = lookbackDateKeys(from);
  const collected: BulkDiscoveredMatch[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < dateKeys.length; i++) {
    if (collected.length >= maxMatches * 3) break;
    const ymd = dateKeys[i]!;
    if (i > 0) await politeDelay();

    const dateUrl = `${CDN}/date/soccer/${ymd}/0?locale=en&countryCode=GB`;
    const feed = await fetchJsonInPage<{ Stages?: DateFeedStage[] }>(page, dateUrl);
    for (const stage of feed?.Stages ?? []) {
      const stageLabel = stage.CompN || stage.Snm || "";
      if (!competitionHintMatch(stageLabel, league)) continue;

      for (const ev of stage.Events ?? []) {
        if (!isFinishedStatus(ev.Eps)) continue;
        const homeRaw = ev.T1?.[0]?.Nm ?? "";
        const awayRaw = ev.T2?.[0]?.Nm ?? "";
        if (!homeRaw || !awayRaw) continue;

        const homeTeam = resolveToAppTeam(homeRaw, league);
        const awayTeam = resolveToAppTeam(awayRaw, league);
        if (!homeTeam || !awayTeam || homeTeam === awayTeam) continue;

        const esd = ev.Esd != null ? String(ev.Esd) : ymd;
        const eventYmd = esd.length >= 8 ? esd.slice(0, 8) : ymd;
        if (!isInSeasonWindow(eventYmd)) continue;

        const eventId = String(ev.Eid);
        if (seen.has(eventId)) continue;
        seen.add(eventId);

        collected.push({
          eventId,
          date: ymdToIso(eventYmd),
          homeTeam,
          awayTeam,
          competition: stageLabel || league,
          status: ev.Eps,
          statsUrl: buildStatsUrl({ eventId }),
        });
      }
    }

    if (selectTopFinished(collected, maxMatches).length >= maxMatches) {
      // Keep scanning a few more days for completeness, but stop early if we have enough
      if (i >= 7) break;
    }
  }

  return selectTopFinished(collected, maxMatches);
}

async function scrapeDiscoveredMatch(
  page: Page,
  row: BulkDiscoveredMatch
): Promise<LogMatch> {
  const base = emptyBulkMatch(newId(), row);
  const cached = await getCachedScrape(row.eventId, row.date, row.homeTeam, row.awayTeam);
  let scrape = cached;
  if (!scrape || scrape.home.goals == null || scrape.away.goals == null) {
    scrape = await scrapeLivescoreStatsPage(page, row.eventId, row.statsUrl);
    await setCachedScrape(scrape);
  }

  const updates = mapScrapeToMatchUpdates(scrape, base, {
    resultSource: "livescore-bulk",
  });
  let merged: LogMatch = {
    ...base,
    ...updates,
    teamStats: updates.teamStats ?? base.teamStats,
    homeTeam: base.homeTeam,
    awayTeam: base.awayTeam,
  };
  merged = applyTeamStatsSync(merged);
  return merged;
}

async function persistLeagueBatch(
  league: string,
  matches: LogMatch[],
  batchDate: string
): Promise<PredictionBatch> {
  const scrapedAt = new Date().toISOString();
  const batch: PredictionBatch = {
    id: newId(),
    date: batchDate,
    league,
    leagueId: resolveLeagueId(league),
    batchName: `Livescore Bulk 2025/26 — ${league} — ${scrapedAt.slice(0, 10)}`,
    createdAt: scrapedAt,
    batchKind: "manual",
    matches,
    bulkScrapeMeta: {
      season: BULK_SEASON,
      source: "livescore-bulk",
      scrapedAt,
    },
  };

  const allBatches = await loadAllBatches();
  const leagueBaselines = computeLeagueBaselines(allBatches);
  const teamsQuality = await loadTeamsQualityStore().catch(() => null);
  const synced = await syncBatchToClubHistories(batch, {
    leagueBaselines,
    teamsQuality,
  });
  await saveBatch(synced);
  await maybeRetrainOnBatchResult(synced).catch(() => null);
  await maybeBayesianCalibrateOnBatch(synced).catch(() => null);
  return synced;
}

/**
 * Process up to `maxLeagues` leagues (default 1) for last-5 bulk history.
 */
export async function runBulkLast5History(options?: {
  leagues?: string[];
  maxLeagues?: number;
  retryFailedFirst?: boolean;
}): Promise<BulkHistorySummary> {
  const maxLeagues = options?.maxLeagues ?? 1;
  const progress = await loadBulkProgress();

  let queue =
    options?.leagues?.length
      ? options.leagues.filter((l) =>
          (LEAGUE_OPTIONS as readonly string[]).includes(l)
        )
      : [...LEAGUE_OPTIONS];

  if (options?.retryFailedFirst !== false && progress.failedLeagues.length) {
    const failed = progress.failedLeagues.filter((l) => queue.includes(l));
    const rest = queue.filter((l) => !failed.includes(l));
    queue = [...failed, ...rest];
  }

  const summary: BulkHistorySummary = {
    doneLeagues: [],
    remainingLeagues: [],
    scraped: 0,
    skippedDuplicates: 0,
    failed: 0,
    errors: [],
    batchIds: [],
  };

  if (!queue.length) return summary;

  const toProcess = queue.slice(0, maxLeagues);
  summary.remainingLeagues = queue.slice(maxLeagues);

  const existing = await loadAllBatches();
  const dedupe = buildExistingDedupeIndex(existing);

  let browser = null;
  let page: Page | null = null;
  const stillFailed = new Set(progress.failedLeagues);

  try {
    browser = await launchLivescoreBrowser();
    page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );
    await page.goto("https://www.livescore.com/en/", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });

    for (const league of toProcess) {
      try {
        const discovered = await discoverLastFinishedForLeague(page, league);
        const fresh = discovered.filter((d) => !isDuplicateMatch(d, dedupe));
        summary.skippedDuplicates += discovered.length - fresh.length;

        if (!fresh.length) {
          summary.doneLeagues.push(league);
          stillFailed.delete(league);
          continue;
        }

        const matches: LogMatch[] = [];
        for (let i = 0; i < fresh.length; i++) {
          if (i > 0) await politeDelay();
          const row = fresh[i]!;
          try {
            const m = await scrapeDiscoveredMatch(page, row);
            matches.push(m);
            dedupe.byEventId.add(row.eventId);
            dedupe.byPairDate.add(matchDedupeKey(row.date, row.homeTeam, row.awayTeam));
            summary.scraped++;
          } catch (e) {
            summary.failed++;
            summary.errors.push(
              `${league} ${row.homeTeam} vs ${row.awayTeam}: ${
                e instanceof Error ? e.message : String(e)
              }`
            );
          }
        }

        if (matches.length) {
          // Group by discovery date so club history gets correct dates
          const byDate = new Map<string, LogMatch[]>();
          for (let i = 0; i < fresh.length; i++) {
            const row = fresh[i]!;
            const scraped = matches.find(
              (m) => m.livescoreEventId === row.eventId
            );
            if (!scraped) continue;
            const list = byDate.get(row.date) ?? [];
            list.push(scraped);
            byDate.set(row.date, list);
          }
          for (const [date, dayMatches] of byDate) {
            const batch = await persistLeagueBatch(league, dayMatches, date);
            summary.batchIds.push(batch.id);
          }
        }

        summary.doneLeagues.push(league);
        stillFailed.delete(league);
      } catch (e) {
        summary.failed++;
        stillFailed.add(league);
        summary.errors.push(
          `${league}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  } finally {
    await closeBrowser(browser);
  }

  await saveBulkProgress({
    failedLeagues: [...stillFailed],
    lastRunAt: new Date().toISOString(),
    lastErrors: summary.errors.slice(0, 20),
  });

  return summary;
}
