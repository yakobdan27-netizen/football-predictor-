import type { Page } from "puppeteer-core";
import { closeBrowser, launchLivescoreBrowser } from "./browser";
import { parseLineupsPayload } from "./parse-api";
import {
  competitionHintMatch,
  toLivescoreDateKey,
  type DateFeedStage,
} from "./resolve-match";
import type { MatchLineups } from "@/lib/prediction-log/types";
import { resolveToAppTeam } from "@/lib/football-api/team-resolve";

const CDN = "https://prod-cdn-public-api.livescore.com/v1/api/app";

export interface LivescoreFixtureRow {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  status?: string;
  competition?: string;
  lineups?: MatchLineups;
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

/**
 * Load fixtures for a date via Puppeteer + Livescore date CDN.
 * Optionally attaches published lineups (including formation) when present.
 */
export async function listLivescoreFixtures(options: {
  date: string;
  competition?: string;
  league?: string;
  includeLineups?: boolean;
  maxLineups?: number;
}): Promise<LivescoreFixtureRow[]> {
  const dateKey = toLivescoreDateKey(options.date);
  const browser = await launchLivescoreBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  );

  try {
    await page.goto("https://www.livescore.com/en/", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });

    const dateUrl = `${CDN}/date/soccer/${dateKey}/0?locale=en&countryCode=GB`;
    const feed = await fetchJsonInPage<{ Stages?: DateFeedStage[] }>(page, dateUrl);
    const stages = feed?.Stages ?? [];
    const rows: LivescoreFixtureRow[] = [];

    for (const stage of stages) {
      const stageLabel = stage.CompN || stage.Snm || "";
      if (!competitionHintMatch(stageLabel, options.competition ?? options.league)) {
        continue;
      }
      for (const ev of stage.Events ?? []) {
        const homeRaw = ev.T1?.[0]?.Nm ?? "";
        const awayRaw = ev.T2?.[0]?.Nm ?? "";
        if (!homeRaw || !awayRaw) continue;

        const league = options.league ?? "";
        const homeTeam =
          (league ? resolveToAppTeam(homeRaw, league) : null) ?? homeRaw;
        const awayTeam =
          (league ? resolveToAppTeam(awayRaw, league) : null) ?? awayRaw;

        rows.push({
          eventId: String(ev.Eid),
          homeTeam,
          awayTeam,
          status: ev.Eps,
          competition: stageLabel || undefined,
        });
      }
    }

    if (options.includeLineups !== false) {
      const max = options.maxLineups ?? 8;
      let fetched = 0;
      for (const row of rows) {
        if (fetched >= max) break;
        const raw = await fetchJsonInPage(page, `${CDN}/lineups/soccer/${row.eventId}?locale=en`);
        const lineups = parseLineupsPayload(raw);
        if (lineups?.home.starting.length) {
          row.lineups = lineups;
          fetched++;
        }
      }
    }

    return rows;
  } finally {
    await closeBrowser(browser);
  }
}
