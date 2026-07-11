import type { Page } from "puppeteer-core";
import { assembleScrapeResult } from "./parse-api";
import {
  buildStatsUrl,
  findEventInDateFeed,
  parseEventIdFromUrl,
  toLivescoreDateKey,
  type DateFeedStage,
} from "./resolve-match";
import type { LivescoreScrapeResult, ResolveMatchInput } from "./types";

const CDN = "https://prod-cdn-public-api.livescore.com/v1/api/app";

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

async function ensureOrigin(page: Page): Promise<void> {
  const url = page.url();
  if (url.includes("livescore.com")) return;
  await page.goto("https://www.livescore.com/en/", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
}

export async function resolveLivescoreEventId(
  page: Page,
  input: ResolveMatchInput
): Promise<{ eventId: string; competition?: string; status?: string } | null> {
  if (input.livescoreEventId?.trim()) {
    return { eventId: input.livescoreEventId.trim() };
  }
  if (input.livescoreUrl?.trim()) {
    const id = parseEventIdFromUrl(input.livescoreUrl);
    if (id) return { eventId: id };
  }

  await ensureOrigin(page);
  const dateKey = toLivescoreDateKey(input.date);
  const dateUrl = `${CDN}/date/soccer/${dateKey}/0?locale=en&countryCode=GB`;
  const feed = await fetchJsonInPage<{ Stages?: DateFeedStage[] }>(page, dateUrl);
  if (!feed?.Stages?.length) return null;

  return findEventInDateFeed(
    feed.Stages,
    input.homeTeam,
    input.awayTeam,
    input.competition
  );
}

export async function scrapeLivescoreStatsPage(
  page: Page,
  eventId: string,
  preferredUrl?: string
): Promise<LivescoreScrapeResult> {
  await ensureOrigin(page);

  let statsUrl = buildStatsUrl({ eventId });
  if (preferredUrl && preferredUrl.includes(eventId)) {
    statsUrl = preferredUrl
      .replace(/\/(line-ups|lineups|summary|odds)\/?/i, "/stats/")
      .replace(/\/?$/, "/");
    if (!/\/stats\/$/i.test(statsUrl)) {
      statsUrl = statsUrl.replace(/\/?$/, "/stats/");
    }
  }

  // Navigate so the browser has Livescore origin; then pull CDN JSON via page.evaluate.
  try {
    await page.goto(statsUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  } catch {
    await ensureOrigin(page);
  }

  const [scoreboard, statistics, lineups, incidents] = await Promise.all([
    fetchJsonInPage(page, `${CDN}/scoreboard/soccer/${eventId}?locale=en`),
    fetchJsonInPage(page, `${CDN}/statistics/soccer/${eventId}?locale=en`),
    fetchJsonInPage(page, `${CDN}/lineups/soccer/${eventId}?locale=en`),
    fetchJsonInPage(page, `${CDN}/incidents/soccer/${eventId}?locale=en`),
  ]);

  if (!scoreboard && !statistics) {
    throw new Error(`Livescore returned no data for event ${eventId}`);
  }

  const finalUrl =
    preferredUrl && preferredUrl.includes(eventId)
      ? preferredUrl
      : `https://www.livescore.com/en/football/match/${eventId}/stats/`;

  const result = assembleScrapeResult({
    eventId,
    url: finalUrl,
    scoreboard,
    statistics,
    lineups,
    incidents,
  });

  if (result.home.goals == null || result.away.goals == null) {
    throw new Error(`Livescore event ${eventId} missing full-time score`);
  }

  return result;
}

export async function resolveAndScrape(
  page: Page,
  input: ResolveMatchInput
): Promise<LivescoreScrapeResult> {
  const resolved = await resolveLivescoreEventId(page, input);
  if (!resolved) {
    throw new Error(
      `No Livescore match found for ${input.homeTeam} vs ${input.awayTeam} on ${input.date}`
    );
  }

  const preferredUrl =
    input.livescoreUrl && input.livescoreUrl.includes(resolved.eventId)
      ? input.livescoreUrl
      : undefined;

  return scrapeLivescoreStatsPage(page, resolved.eventId, preferredUrl);
}
