/**
 * API-Football league id → The Stats API competition_id.
 * IDs taken from thestatsapi.com league pages / OpenAPI examples.
 */
export const AF_TO_STATS_API_COMPETITION: Record<number, string> = {
  39: "comp_3039", // Premier League
  140: "comp_8814", // La Liga
  135: "comp_5840", // Serie A
  78: "comp_4643", // Bundesliga
  61: "comp_0256", // Ligue 1
  2: "comp_3498", // UEFA Champions League
  3: "comp_7739", // UEFA Europa League
};

export const STATS_API_PL_COMPETITION_ID = "comp_3039";
export const AF_PREMIER_LEAGUE_ID = 39;

export function statsApiCompetitionIdForAfLeague(
  leagueId: number | null | undefined
): string | null {
  if (leagueId == null) return null;
  return AF_TO_STATS_API_COMPETITION[leagueId] ?? null;
}

/** Competition ids for the Live-tracked Big-5 set. */
export function statsApiTrackedCompetitionIds(): string[] {
  return Object.values(AF_TO_STATS_API_COMPETITION);
}

export function statsApiCompetitionIdsForAfLeagues(
  leagueIds: Iterable<number>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of leagueIds) {
    const cid = AF_TO_STATS_API_COMPETITION[id];
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);
    out.push(cid);
  }
  return out;
}
