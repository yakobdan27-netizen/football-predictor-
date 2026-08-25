/**
 * Per-team half attack/defence rates from Match Centre live_* (2026/27).
 * Used as the current-season (60%) side of the nested API blend.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { standardizeTeamName } from "@/lib/data/team-names";
import { getDb } from "@/lib/db";
import { liveEvents, liveFixtures, liveLeagues } from "@/lib/db/schema";
import { LEAGUE_API_IDS } from "@/lib/football-api/leagues";
import {
  API_CURRENT_SEASON_YEAR,
  matchCentreRatesCacheKey,
} from "@/lib/prediction-log/api-season-blend";
import type { ClubHalfAttackDefence } from "@/lib/prediction-log/hsh-half-rates";
import { LIVE_LEAGUE_IDS, LIVE_STATUSES } from "@/lib/live/constants";

export type MatchCentreGoalEvent = {
  minute: number | null;
  type: string | null;
  team: string | null;
};

export type MatchCentreFixtureHalfRow = {
  fixtureId: number;
  leagueId: number;
  leagueName: string | null;
  homeTeam: string;
  awayTeam: string;
  kickoffUtc?: string | null;
  homeGoals: number | null;
  awayGoals: number | null;
  homeGoals1h: number | null;
  awayGoals1h: number | null;
};

const LEAGUE_ID_TO_NAME = new Map<number, string>(
  Object.entries(LEAGUE_API_IDS).map(([name, id]) => [id, name])
);

function teamKey(name: string): string {
  return standardizeTeamName(name).trim().toLowerCase();
}

export function halfGoalsFromEvents(
  events: MatchCentreGoalEvent[],
  home: string,
  away: string
): { homeGoals1h: number | null; awayGoals1h: number | null } {
  const goals = events.filter((e) => {
    const t = (e.type ?? "").toLowerCase();
    return t.includes("goal") && !t.includes("missed");
  });
  if (!goals.length) return { homeGoals1h: null, awayGoals1h: null };

  let homeGoals1h = 0;
  let awayGoals1h = 0;
  let saw1h = false;
  for (const g of goals) {
    const minute = g.minute ?? 99;
    if (minute > 45) continue;
    saw1h = true;
    const team = (g.team ?? "").trim();
    if (team === home) homeGoals1h += 1;
    else if (team === away) awayGoals1h += 1;
  }
  if (!saw1h) return { homeGoals1h: null, awayGoals1h: null };
  return { homeGoals1h, awayGoals1h };
}

type TeamHalfAccumulator = {
  n: number;
  sAf1: number;
  sAf2: number;
  sDa1: number;
  sDa2: number;
};

function emptyAcc(): TeamHalfAccumulator {
  return { n: 0, sAf1: 0, sAf2: 0, sDa1: 0, sDa2: 0 };
}

/** Aggregate half rates for one team from finished fixture rows. */
export function aggregateTeamHalfRatesFromFixtures(
  fixtures: MatchCentreFixtureHalfRow[],
  team: string,
  league: string
): { n: number; af1: number; af2: number; da1: number; da2: number } {
  const key = teamKey(team);
  const acc = emptyAcc();

  for (const f of fixtures) {
    const leagueName =
      f.leagueName ?? LEAGUE_ID_TO_NAME.get(f.leagueId) ?? null;
    if (leagueName !== league) continue;

    const homeKey = teamKey(f.homeTeam);
    const awayKey = teamKey(f.awayTeam);
    const venue =
      homeKey === key ? "home" : awayKey === key ? "away" : null;
    if (!venue) continue;

    const hg = f.homeGoals;
    const ag = f.awayGoals;
    const h1 = f.homeGoals1h;
    const a1 = f.awayGoals1h;
    if (
      hg == null ||
      ag == null ||
      h1 == null ||
      a1 == null ||
      !Number.isFinite(hg) ||
      !Number.isFinite(ag) ||
      !Number.isFinite(h1) ||
      !Number.isFinite(a1)
    ) {
      continue;
    }

    const scored1h = venue === "home" ? h1 : a1;
    const scored2h = venue === "home" ? Math.max(0, hg - h1) : Math.max(0, ag - a1);
    const conc1h = venue === "home" ? a1 : h1;
    const conc2h = venue === "home" ? Math.max(0, ag - a1) : Math.max(0, hg - h1);

    acc.n += 1;
    acc.sAf1 += scored1h;
    acc.sAf2 += scored2h;
    acc.sDa1 += conc1h;
    acc.sDa2 += conc2h;
  }

  if (acc.n === 0) {
    return { n: 0, af1: 0, af2: 0, da1: 0, da2: 0 };
  }
  return {
    n: acc.n,
    af1: acc.sAf1 / acc.n,
    af2: acc.sAf2 / acc.n,
    da1: acc.sDa1 / acc.n,
    da2: acc.sDa2 / acc.n,
  };
}

/** Last N finished fixtures per team (kickoff descending). */
export function aggregateTeamHalfRatesFromLastNFixtures(
  fixtures: MatchCentreFixtureHalfRow[],
  team: string,
  league: string,
  n = 5
): { n: number; af1: number; af2: number; da1: number; da2: number } {
  const key = teamKey(team);
  const teamFixtures = fixtures.filter((f) => {
    const leagueName =
      f.leagueName ?? LEAGUE_ID_TO_NAME.get(f.leagueId) ?? null;
    if (leagueName !== league) return false;
    const homeKey = teamKey(f.homeTeam);
    const awayKey = teamKey(f.awayTeam);
    return homeKey === key || awayKey === key;
  });

  teamFixtures.sort((a, b) => {
    const ta = a.kickoffUtc ? Date.parse(a.kickoffUtc) : 0;
    const tb = b.kickoffUtc ? Date.parse(b.kickoffUtc) : 0;
    return tb - ta;
  });

  return aggregateTeamHalfRatesFromFixtures(
    teamFixtures.slice(0, n),
    team,
    league
  );
}

function toClubHalfAttackDefence(
  team: string,
  league: string,
  rates: { n: number; af1: number; af2: number; da1: number; da2: number },
  opts?: { lastN?: boolean }
): ClubHalfAttackDefence {
  return {
    clubName: standardizeTeamName(team),
    league,
    af1: rates.af1,
    af2: rates.af2,
    da1: rates.da1,
    da2: rates.da2,
    nMatches: rates.n,
    seasonCount: rates.n > 0 ? 1 : 0,
    seedOnly: false,
    sourceNote:
      rates.n > 0
        ? opts?.lastN
          ? `match-centre-last5: ${API_CURRENT_SEASON_YEAR} n=${rates.n}`
          : `match-centre: ${API_CURRENT_SEASON_YEAR} n=${rates.n}`
        : null,
  };
}

async function loadSeasonFixturesForLeagues(
  leagueIds: number[]
): Promise<MatchCentreFixtureHalfRow[]> {
  if (!leagueIds.length) return [];

  const db = await getDb();
  const finished = [...LIVE_STATUSES.finished];
  const rows = await db
    .select({
      fixture: liveFixtures,
      leagueName: liveLeagues.name,
    })
    .from(liveFixtures)
    .leftJoin(liveLeagues, eq(liveFixtures.leagueId, liveLeagues.leagueId))
    .where(
      and(
        inArray(liveFixtures.leagueId, leagueIds),
        eq(liveFixtures.season, API_CURRENT_SEASON_YEAR),
        inArray(liveFixtures.status, finished)
      )
    )
    .orderBy(asc(liveFixtures.kickoffUtc));

  if (!rows.length) return [];

  const fixtureIds = rows.map((r) => r.fixture.fixtureId);
  const eventRows = await db
    .select()
    .from(liveEvents)
    .where(inArray(liveEvents.fixtureId, fixtureIds))
    .orderBy(asc(liveEvents.minute), asc(liveEvents.id));

  const eventsByFixture = new Map<number, MatchCentreGoalEvent[]>();
  for (const e of eventRows) {
    const list = eventsByFixture.get(e.fixtureId) ?? [];
    list.push({
      minute: e.minute,
      type: e.type,
      team: e.team,
    });
    eventsByFixture.set(e.fixtureId, list);
  }

  return rows.map(({ fixture: f, leagueName }) => {
    const goals = eventsByFixture.get(f.fixtureId) ?? [];
    const { homeGoals1h, awayGoals1h } = halfGoalsFromEvents(
      goals,
      f.homeTeam,
      f.awayTeam
    );
    return {
      fixtureId: f.fixtureId,
      leagueId: f.leagueId,
      leagueName: leagueName ?? LEAGUE_ID_TO_NAME.get(f.leagueId) ?? null,
      homeTeam: f.homeTeam,
      awayTeam: f.awayTeam,
      kickoffUtc: f.kickoffUtc.toISOString(),
      homeGoals: f.homeGoals,
      awayGoals: f.awayGoals,
      homeGoals1h,
      awayGoals1h,
    };
  });
}

export async function queryMatchCentreTeamHalfRates(
  team: string,
  league: string
): Promise<ClubHalfAttackDefence> {
  const leagueId = LEAGUE_API_IDS[league as keyof typeof LEAGUE_API_IDS];
  if (leagueId == null) {
    return toClubHalfAttackDefence(team, league, {
      n: 0,
      af1: 0,
      af2: 0,
      da1: 0,
      da2: 0,
    });
  }

  const fixtures = await loadSeasonFixturesForLeagues([leagueId]);
  const rates = aggregateTeamHalfRatesFromFixtures(fixtures, team, league);
  return toClubHalfAttackDefence(team, league, rates);
}

export async function queryMatchCentreTeamHalfRatesLast5(
  team: string,
  league: string
): Promise<ClubHalfAttackDefence> {
  const leagueId = LEAGUE_API_IDS[league as keyof typeof LEAGUE_API_IDS];
  if (leagueId == null) {
    return toClubHalfAttackDefence(
      team,
      league,
      { n: 0, af1: 0, af2: 0, da1: 0, da2: 0 },
      { lastN: true }
    );
  }

  const fixtures = await loadSeasonFixturesForLeagues([leagueId]);
  const rates = aggregateTeamHalfRatesFromLastNFixtures(
    fixtures,
    team,
    league,
    5
  );
  return toClubHalfAttackDefence(team, league, rates, { lastN: true });
}

export async function preloadMatchCentreHalfRates(
  teams: { team: string; league: string }[]
): Promise<Map<string, ClubHalfAttackDefence>> {
  const out = new Map<string, ClubHalfAttackDefence>();
  if (!teams.length) return out;

  const leagueIds = new Set<number>();
  for (const { league } of teams) {
    const id = LEAGUE_API_IDS[league as keyof typeof LEAGUE_API_IDS];
    if (id != null && LIVE_LEAGUE_IDS.includes(id)) leagueIds.add(id);
  }

  const fixtures = await loadSeasonFixturesForLeagues([...leagueIds]);

  for (const { team, league } of teams) {
    const key = matchCentreRatesCacheKey(team, league);
    if (out.has(key)) continue;
    const rates = aggregateTeamHalfRatesFromFixtures(fixtures, team, league);
    out.set(key, toClubHalfAttackDefence(team, league, rates));
  }

  return out;
}

/** Preload last-5 Match Centre half rates per team (system-season 30% recent side). */
export async function preloadMatchCentreLast5HalfRates(
  teams: { team: string; league: string }[]
): Promise<Map<string, ClubHalfAttackDefence>> {
  const out = new Map<string, ClubHalfAttackDefence>();
  if (!teams.length) return out;

  const leagueIds = new Set<number>();
  for (const { league } of teams) {
    const id = LEAGUE_API_IDS[league as keyof typeof LEAGUE_API_IDS];
    if (id != null && LIVE_LEAGUE_IDS.includes(id)) leagueIds.add(id);
  }

  const fixtures = await loadSeasonFixturesForLeagues([...leagueIds]);

  for (const { team, league } of teams) {
    const key = matchCentreRatesCacheKey(team, league);
    if (out.has(key)) continue;
    const rates = aggregateTeamHalfRatesFromLastNFixtures(
      fixtures,
      team,
      league,
      5
    );
    out.set(key, toClubHalfAttackDefence(team, league, rates, { lastN: true }));
  }

  return out;
}
