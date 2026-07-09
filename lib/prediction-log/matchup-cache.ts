import type { ClubRecord, MatchupCache } from "./club-record-types";
import { KV_KEYS } from "./kv-keys";
import { getJson, setJson } from "./kv";

export function buildMatchupCache(
  clubA: ClubRecord,
  clubB: ClubRecord
): MatchupCache {
  const meetings: { date: string; winner: "a" | "b" | "draw" }[] = [];

  for (const entry of clubA.histories.winLose) {
    if (entry.superseded || entry.result === "pending") continue;
    if (entry.opponentId !== clubB.clubId) continue;
    const actual = String(entry.actual ?? entry.predicted);
    if (actual === "win") meetings.push({ date: entry.date, winner: "a" });
    else if (actual === "lose") meetings.push({ date: entry.date, winner: "b" });
    else meetings.push({ date: entry.date, winner: "draw" });
  }

  meetings.sort((a, b) => b.date.localeCompare(a.date));

  return {
    clubIdA: clubA.clubId,
    clubIdB: clubB.clubId,
    clubNameA: clubA.clubName,
    clubNameB: clubB.clubName,
    meetings: meetings.length,
    homeWinsA: meetings.filter((m) => m.winner === "a").length,
    awayWinsA: meetings.filter((m) => m.winner === "b").length,
    draws: meetings.filter((m) => m.winner === "draw").length,
    lastMeeting: meetings[0]?.date,
    updatedAt: new Date().toISOString(),
  };
}

export async function saveMatchupCache(cache: MatchupCache): Promise<void> {
  await setJson(KV_KEYS.matchup(cache.clubIdA, cache.clubIdB), cache);
}

export async function loadMatchupCache(
  clubIdA: string,
  clubIdB: string
): Promise<MatchupCache | null> {
  return getJson<MatchupCache>(KV_KEYS.matchup(clubIdA, clubIdB));
}
