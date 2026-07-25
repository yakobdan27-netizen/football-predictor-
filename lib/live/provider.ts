/**
 * Live fixtures provider — wraps API-Football behind a narrow interface.
 * Isolation: only talks to api-sports; storage is handled by store.ts.
 */
import {
  getApiFootballBaseUrl,
  getApiFootballKey,
  type ApiFootballResponse,
} from "@/lib/football-api/client";
import {
  backoffOn429,
  noteRateLimitHeaders,
  waitIfRateLimited,
} from "./rate-limit";
import type { LiveApiEvent, LiveApiFixture } from "./types";

async function liveGet<T>(
  path: string,
  params: Record<string, string | number> = {}
): Promise<T> {
  await waitIfRateLimited();
  const key = getApiFootballKey();
  const base = getApiFootballBaseUrl();
  const url = new URL(path.startsWith("http") ? path : `${base}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.append(k, String(v));
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "x-apisports-key": key,
          Accept: "application/json",
        },
        cache: "no-store",
      });
      noteRateLimitHeaders(res.headers);
      if (res.status === 429) {
        await backoffOn429(attempt);
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const payload = (await res.json()) as ApiFootballResponse<T>;
      if (payload.errors) {
        const msg =
          typeof payload.errors === "object" && !Array.isArray(payload.errors)
            ? JSON.stringify(payload.errors)
            : String(payload.errors);
        if (msg && msg !== "{}" && msg !== "[]") {
          throw new Error(`API errors: ${msg}`);
        }
      }
      return payload.response;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < 3 && /HTTP 429|rate/i.test(lastError.message)) {
        await backoffOn429(attempt);
        continue;
      }
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
      }
    }
  }
  throw new Error(`Live API failed for ${path}: ${lastError?.message}`);
}

export interface LiveFixturesProvider {
  fetchSeasonFixtures(leagueId: number, season: number): Promise<LiveApiFixture[]>;
  fetchLiveAll(): Promise<LiveApiFixture[]>;
  fetchByIds(ids: number[]): Promise<LiveApiFixture[]>;
  fetchByDate(date: string, leagueId?: number): Promise<LiveApiFixture[]>;
  fetchDateRange(
    leagueId: number,
    season: number,
    from: string,
    to: string
  ): Promise<LiveApiFixture[]>;
  fetchEvents(fixtureId: number): Promise<LiveApiEvent[]>;
}

export const apiSportsLiveProvider: LiveFixturesProvider = {
  async fetchSeasonFixtures(leagueId, season) {
    const rows = await liveGet<LiveApiFixture[]>("/fixtures", {
      league: leagueId,
      season,
    });
    return rows ?? [];
  },

  async fetchLiveAll() {
    const rows = await liveGet<LiveApiFixture[]>("/fixtures", { live: "all" });
    return rows ?? [];
  },

  async fetchByIds(ids) {
    if (!ids.length) return [];
    // API allows up to 20 ids separated by -
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += 20) {
      chunks.push(ids.slice(i, i + 20));
    }
    const out: LiveApiFixture[] = [];
    for (const chunk of chunks) {
      const rows = await liveGet<LiveApiFixture[]>("/fixtures", {
        ids: chunk.join("-"),
      });
      if (rows?.length) out.push(...rows);
    }
    return out;
  },

  async fetchByDate(date, leagueId) {
    const params: Record<string, string | number> = { date };
    if (leagueId != null) params.league = leagueId;
    const rows = await liveGet<LiveApiFixture[]>("/fixtures", params);
    return rows ?? [];
  },

  async fetchDateRange(leagueId, season, from, to) {
    const rows = await liveGet<LiveApiFixture[]>("/fixtures", {
      league: leagueId,
      season,
      from,
      to,
    });
    return rows ?? [];
  },

  async fetchEvents(fixtureId) {
    const rows = await liveGet<LiveApiEvent[]>("/fixtures/events", {
      fixture: fixtureId,
    });
    return rows ?? [];
  },
};
