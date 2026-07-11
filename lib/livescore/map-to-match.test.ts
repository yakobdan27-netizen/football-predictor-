import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { assembleScrapeResult } from "./parse-api";
import { mapScrapeToMatchUpdates, scrapeToTeamStats } from "./map-to-match";
import {
  findEventInDateFeed,
  parseEventIdFromUrl,
  toLivescoreDateKey,
} from "./resolve-match";
import type { LogMatch } from "@/lib/prediction-log/types";

const fixtureDir = join(process.cwd(), "lib", "livescore", "__fixtures__");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
}

test("parseEventIdFromUrl extracts id from stats URL", () => {
  assert.equal(
    parseEventIdFromUrl(
      "https://www.livescore.com/en/football/international/world-cup-2026/spain-vs-belgium/1417899/stats/"
    ),
    "1417899"
  );
});

test("toLivescoreDateKey normalizes ISO and slash dates", () => {
  assert.equal(toLivescoreDateKey("2026-07-10"), "20260710");
  assert.equal(toLivescoreDateKey("10/07/2026"), "20260710");
});

test("findEventInDateFeed matches home/away with competition bonus", () => {
  const hit = findEventInDateFeed(
    [
      {
        CompN: "World Cup",
        Events: [
          {
            Eid: "1417899",
            Eps: "FT",
            T1: [{ Nm: "Spain" }],
            T2: [{ Nm: "Belgium" }],
          },
        ],
      },
    ],
    "Spain",
    "Belgium",
    "World Cup"
  );
  assert.ok(hit);
  assert.equal(hit!.eventId, "1417899");
});

test("assembleScrapeResult maps Spain vs Belgium fixtures", () => {
  const scrape = assembleScrapeResult({
    eventId: "1417899",
    url: "https://www.livescore.com/en/football/international/world-cup-2026/spain-vs-belgium/1417899/stats/",
    scoreboard: loadFixture("scoreboard-1417899.json"),
    statistics: loadFixture("statistics-1417899.json"),
    lineups: loadFixture("lineups-1417899.json"),
    incidents: loadFixture("incidents-1417899.json"),
  });

  assert.equal(scrape.homeTeam, "Spain");
  assert.equal(scrape.awayTeam, "Belgium");
  assert.equal(scrape.home.goals, 2);
  assert.equal(scrape.away.goals, 1);
  assert.equal(scrape.home.firstHalfGoals, 1);
  assert.equal(scrape.away.firstHalfGoals, 1);
  assert.equal(scrape.home.possession, 68);
  assert.equal(scrape.away.possession, 32);
  assert.equal(scrape.home.shotsOnTarget, 8);
  assert.equal(scrape.away.shotsOnTarget, 2);
  assert.equal(scrape.home.totalShots, 8 + 4 + 5);
  assert.equal(scrape.home.corners, 5);
  assert.equal(scrape.away.fouls, 18);
  assert.equal(scrape.goalInFirst10, false);
  assert.equal(scrape.firstGoalSide, "home");
  assert.equal(scrape.lineups?.home.starting.length, 11);
  assert.equal(scrape.lineups?.home.formation, "4-2-3-1");
  assert.equal(scrape.lineups?.away.formation, "4-3-3");
  assert.ok((scrape.lineups?.home.substitutes.length ?? 0) >= 1);
  assert.equal(scrape.lineups?.away.starting.length, 11);
});

test("mapScrapeToMatchUpdates fills empty fields only and marks livescore source", () => {
  const scrape = assembleScrapeResult({
    eventId: "1417899",
    url: "https://www.livescore.com/en/football/international/world-cup-2026/spain-vs-belgium/1417899/stats/",
    scoreboard: loadFixture("scoreboard-1417899.json"),
    statistics: loadFixture("statistics-1417899.json"),
    lineups: loadFixture("lineups-1417899.json"),
    incidents: loadFixture("incidents-1417899.json"),
  });

  const match: LogMatch = {
    id: "m1",
    homeTeam: "Spain",
    awayTeam: "Belgium",
    predictions: { "1x2": { prediction: "home", confidence: 60 } },
    actualResults: {},
    scored: {},
    teamStats: {
      home: { goals: 9, corners: 1 },
      away: {},
    },
  };

  const updates = mapScrapeToMatchUpdates(scrape, match);
  assert.equal(updates.resultSource, "livescore");
  assert.equal(updates.livescoreEventId, "1417899");
  assert.equal(updates.teamStats?.home.goals, 9);
  assert.equal(updates.teamStats?.home.corners, 1);
  assert.equal(updates.teamStats?.away.goals, 1);
  assert.equal(updates.teamStats?.home.possession, 68);
  assert.equal(updates.teamStats?.lineups?.home.starting.length, 11);

  const stats = scrapeToTeamStats(scrape);
  assert.equal(stats.home.goals, 2);
  assert.equal(stats.goalTiming?.goalInFirst10, false);
});

test("optional live CDN smoke for event 1417899", { skip: process.env.LIVESCORE_SMOKE !== "1" }, async () => {
  const base = "https://prod-cdn-public-api.livescore.com/v1/api/app";
  const eid = "1417899";
  const [scoreboard, statistics, lineups, incidents] = await Promise.all([
    fetch(`${base}/scoreboard/soccer/${eid}?locale=en`).then((r) => r.json()),
    fetch(`${base}/statistics/soccer/${eid}?locale=en`).then((r) => r.json()),
    fetch(`${base}/lineups/soccer/${eid}?locale=en`).then((r) => r.json()),
    fetch(`${base}/incidents/soccer/${eid}?locale=en`).then((r) => r.json()),
  ]);
  const scrape = assembleScrapeResult({
    eventId: eid,
    url: `https://www.livescore.com/en/football/international/world-cup-2026/spain-vs-belgium/${eid}/stats/`,
    scoreboard,
    statistics,
    lineups,
    incidents,
  });
  assert.equal(scrape.home.goals, 2);
  assert.equal(scrape.away.goals, 1);
  assert.ok((scrape.lineups?.home.starting.length ?? 0) >= 11);
});
