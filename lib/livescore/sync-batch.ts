import { closeBrowser, launchLivescoreBrowser } from "./browser";
import { getCachedScrape, setCachedScrape } from "./cache";
import { mapScrapeToMatchUpdates } from "./map-to-match";
import { resolveAndScrape } from "./scrape-stats-page";
import type { LivescoreScrapeResult } from "./types";
import { loadBatch, saveBatch, loadAllBatches } from "@/lib/prediction-log/club-store";
import { syncBatchToClubHistories } from "@/lib/prediction-log/club-history-writer";
import { maybeRetrainOnBatchResult } from "@/lib/prediction-log/retrain-ml";
import { maybeBayesianCalibrateOnBatch } from "@/lib/prediction-log/bayesian-calibration";
import { computeLeagueBaselines } from "@/lib/prediction-log/league-baselines";
import { loadTeamsQualityStore } from "@/lib/prediction-log/teams-quality-store";
import { applyTeamStatsSync } from "@/lib/prediction-log/team-stats-sync";
import { scoreMatch, scoreBatch, marketsEnteredCount } from "@/lib/prediction-log/scoring";
import type { LogMarketKey, LogMatch, PredictionBatch } from "@/lib/prediction-log/types";
import type { Page } from "puppeteer-core";

const MAX_SCRAPES_PER_REQUEST = 3;
const DELAY_MS_MIN = 1500;
const DELAY_MS_MAX = 2500;
/** Stop starting new scrapes with this much wall time left (ms). */
const TIME_BUDGET_MS = 50_000;

export interface ScrapeLivescoreSummary {
  filled: number;
  failed: number;
  cached: number;
  remaining: string[];
  errors: string[];
  batch?: PredictionBatch;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function politeDelay(): Promise<void> {
  const ms = DELAY_MS_MIN + Math.floor(Math.random() * (DELAY_MS_MAX - DELAY_MS_MIN));
  return sleep(ms);
}

export function matchNeedsResultFill(match: LogMatch): boolean {
  const hg = match.teamStats?.home?.goals;
  const ag = match.teamStats?.away?.goals;
  if (hg == null || ag == null) return true;

  for (const key of Object.keys(match.predictions) as LogMarketKey[]) {
    const actual = match.actualResults[key]?.actual;
    const scored = match.scored[key];
    if (actual == null || (typeof actual === "string" && actual.trim() === "") || scored == null) {
      return true;
    }
  }
  return false;
}

function batchDateIsPastOrToday(date: string): boolean {
  const digits = date.replace(/[^0-9]/g, "");
  let ymd = "";
  if (/^\d{4}-\d{2}-\d{2}/.test(date.trim())) {
    ymd = date.trim().slice(0, 10).replace(/-/g, "");
  } else if (digits.length >= 8) {
    ymd = digits.slice(0, 8);
  } else {
    return true;
  }
  const today = new Date();
  const todayKey = `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, "0")}${String(today.getUTCDate()).padStart(2, "0")}`;
  return ymd <= todayKey;
}

async function scrapeOne(
  page: Page,
  match: LogMatch,
  batch: PredictionBatch
): Promise<{ match: LogMatch; fromCache: boolean }> {
  const cached = await getCachedScrape(
    match.livescoreEventId,
    batch.date,
    match.homeTeam,
    match.awayTeam
  );

  let scrape: LivescoreScrapeResult;
  let fromCache = false;

  if (cached && cached.home.goals != null && cached.away.goals != null) {
    scrape = cached;
    fromCache = true;
  } else {
    scrape = await resolveAndScrape(page, {
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      date: batch.date,
      competition: batch.league,
      livescoreUrl: match.livescoreUrl,
      livescoreEventId: match.livescoreEventId,
    });
    await setCachedScrape(scrape);
  }

  const updates = mapScrapeToMatchUpdates(scrape, match);
  let merged: LogMatch = {
    ...match,
    ...updates,
    teamStats: updates.teamStats ?? match.teamStats,
  };
  merged = applyTeamStatsSync(merged);
  merged = scoreMatch(merged);
  return { match: merged, fromCache };
}

export async function syncBatchFromLivescore(options: {
  batchId: string;
  matchIds?: string[];
  /** Max live scrapes (cache hits do not count). */
  maxScrapes?: number;
}): Promise<ScrapeLivescoreSummary> {
  const summary: ScrapeLivescoreSummary = {
    filled: 0,
    failed: 0,
    cached: 0,
    remaining: [],
    errors: [],
  };

  const batch = await loadBatch(options.batchId);
  if (!batch) {
    summary.errors.push(`Batch not found: ${options.batchId}`);
    return summary;
  }

  if (!batchDateIsPastOrToday(batch.date)) {
    summary.errors.push("Batch date is in the future; skipping Livescore scrape.");
    summary.batch = batch;
    return summary;
  }

  const maxScrapes = options.maxScrapes ?? MAX_SCRAPES_PER_REQUEST;
  const idFilter = options.matchIds?.length ? new Set(options.matchIds) : null;

  const pending = batch.matches.filter((m) => {
    if (idFilter && !idFilter.has(m.id)) return false;
    return matchNeedsResultFill(m);
  });

  if (!pending.length) {
    summary.batch = batch;
    return summary;
  }

  const started = Date.now();
  let browser = null;
  let page: Page | null = null;
  let scrapesUsed = 0;
  let batchChanged = false;
  const byId = new Map(batch.matches.map((m) => [m.id, m]));

  try {
    for (const match of pending) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        summary.remaining.push(match.id);
        continue;
      }

      const cacheHit = await getCachedScrape(
        match.livescoreEventId,
        batch.date,
        match.homeTeam,
        match.awayTeam
      );
      const needsLive = !(cacheHit && cacheHit.home.goals != null && cacheHit.away.goals != null);

      if (needsLive && scrapesUsed >= maxScrapes) {
        summary.remaining.push(match.id);
        continue;
      }

      try {
        if (!browser) {
          browser = await launchLivescoreBrowser();
          page = await browser.newPage();
          await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
          );
        }

        if (needsLive && scrapesUsed > 0) {
          await politeDelay();
        }

        const { match: updated, fromCache } = await scrapeOne(page!, match, batch);
        byId.set(match.id, updated);
        batchChanged = true;
        summary.filled++;
        if (fromCache) summary.cached++;
        else scrapesUsed++;
      } catch (e) {
        summary.failed++;
        summary.errors.push(
          `${match.homeTeam} vs ${match.awayTeam}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    // Any pending not processed due to early continue already in remaining;
    // also mark unattempted after failures budget
    for (const m of pending) {
      if (!byId.has(m.id)) continue;
      const original = batch.matches.find((x) => x.id === m.id);
      if (original && byId.get(m.id) === original && !summary.remaining.includes(m.id)) {
        // unchanged and not listed — already counted as failed or skipped
      }
    }
  } finally {
    await closeBrowser(browser);
  }

  if (!batchChanged) {
    summary.batch = batch;
    return summary;
  }

  const updatedMatches = batch.matches.map((m) => byId.get(m.id) ?? m);
  let updatedBatch: PredictionBatch = scoreBatch({ ...batch, matches: updatedMatches });
  const entered = marketsEnteredCount(updatedBatch);
  if (entered.total > 0 && entered.scored === entered.total) {
    updatedBatch = {
      ...updatedBatch,
      recommendationStatus:
        updatedBatch.batchKind === "recommended" ? "SETTLED" : updatedBatch.recommendationStatus,
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
    summary.batch = synced;
  } catch (e) {
    summary.errors.push(
      `Failed to save batch: ${e instanceof Error ? e.message : String(e)}`
    );
    summary.batch = updatedBatch;
  }

  return summary;
}
