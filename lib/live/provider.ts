/**
 * Live fixtures provider — wraps API-Football behind a narrow interface.
 * Isolation: only talks to api-sports via lib/apiClient; storage is store.ts.
 */
import { apiFootballGet } from "@/lib/apiClient";
import type { LiveApiEvent, LiveApiFixture } from "./types";

export interface LiveFixturesProvider {
  fetchSeasonFixtures(leagueId: number, season: number): Promise<LiveApiFixture[]>;
  fetchLiveAll(): Promise<LiveApiFixture[]>;
  fetchByIds(ids: number[]): Promise<LiveApiFixture[]>;
  fetchById(id: number): Promise<LiveApiFixture | null>;
  fetchByDate(date: string, leagueId?: number): Promise<LiveApiFixture[]>;
  fetchDateRange(
    leagueId: number,
    season: number,
    from: string,
    to: string
  ): Promise<LiveApiFixture[]>;
  fetchEvents(fixtureId: number): Promise<LiveApiEvent[]>;
  fetchLineups(fixtureId: number): Promise<unknown[]>;
  fetchStatistics(fixtureId: number): Promise<unknown[]>;
}

export const apiSportsLiveProvider: LiveFixturesProvider = {
  async fetchSeasonFixtures(leagueId, season) {
    const rows = await apiFootballGet<LiveApiFixture[]>("/fixtures", {
      league: leagueId,
      season,
    });
    return rows ?? [];
  },

  async fetchLiveAll() {
    const rows = await apiFootballGet<LiveApiFixture[]>("/fixtures", {
      live: "all",
    });
    return rows ?? [];
  },

  async fetchByIds(ids) {
    if (!ids.length) return [];
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += 20) {
      chunks.push(ids.slice(i, i + 20));
    }
    const out: LiveApiFixture[] = [];
    for (const chunk of chunks) {
      const rows = await apiFootballGet<LiveApiFixture[]>("/fixtures", {
        ids: chunk.join("-"),
      });
      if (rows?.length) out.push(...rows);
    }
    return out;
  },

  async fetchById(id) {
    const rows = await apiFootballGet<LiveApiFixture[]>("/fixtures", { id });
    return rows?.[0] ?? null;
  },

  async fetchByDate(date, leagueId) {
    const params: Record<string, string | number> = { date };
    if (leagueId != null) params.league = leagueId;
    const rows = await apiFootballGet<LiveApiFixture[]>("/fixtures", params);
    return rows ?? [];
  },

  async fetchDateRange(leagueId, season, from, to) {
    const rows = await apiFootballGet<LiveApiFixture[]>("/fixtures", {
      league: leagueId,
      season,
      from,
      to,
    });
    return rows ?? [];
  },

  async fetchEvents(fixtureId) {
    const rows = await apiFootballGet<LiveApiEvent[]>("/fixtures/events", {
      fixture: fixtureId,
    });
    return rows ?? [];
  },

  async fetchLineups(fixtureId) {
    const rows = await apiFootballGet<unknown[]>("/fixtures/lineups", {
      fixture: fixtureId,
    });
    return rows ?? [];
  },

  async fetchStatistics(fixtureId) {
    const rows = await apiFootballGet<unknown[]>("/fixtures/statistics", {
      fixture: fixtureId,
    });
    return rows ?? [];
  },
};
