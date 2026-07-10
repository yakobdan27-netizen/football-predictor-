import { allDemoTeams } from "@/lib/data/demo-teams";
import { lookupTeam, slugifyTeamId, teamNameKey } from "./teams-quality";
import type { QualityTier, TeamsQualityStore } from "./teams-quality-types";

const DEFAULT_DISPLAY_TIER: QualityTier = "C";

export interface StagingTeamRow {
  team_name: string;
  team_id: string;
  tier: QualityTier;
  inStore: boolean;
  isCustom: boolean;
  leagues: string[];
}

export function buildStagingRows(store: TeamsQualityStore | null): StagingTeamRow[] {
  const roster = allDemoTeams();
  const rosterKeys = new Set(roster.map(teamNameKey));
  const rows: StagingTeamRow[] = [];

  for (const name of roster) {
    const saved = lookupTeam(store, name);
    rows.push({
      team_name: name,
      team_id: saved?.team_id ?? slugifyTeamId(name),
      tier: saved?.tier ?? DEFAULT_DISPLAY_TIER,
      inStore: saved != null,
      isCustom: false,
      leagues: saved?.leagues ?? [],
    });
  }

  if (store) {
    for (const team of store.teams) {
      if (rosterKeys.has(teamNameKey(team.team_name))) continue;
      rows.push({
        team_name: team.team_name,
        team_id: team.team_id,
        tier: team.tier,
        inStore: true,
        isCustom: true,
        leagues: team.leagues ?? [],
      });
    }
  }

  rows.sort((a, b) => a.team_name.localeCompare(b.team_name));
  return rows;
}

export function filterStagingRows(
  rows: StagingTeamRow[],
  tierFilter: QualityTier | "all",
  search: string
): StagingTeamRow[] {
  return rows.filter((row) => {
    if (tierFilter !== "all" && row.tier !== tierFilter) return false;
    if (!search.trim()) return true;
    return row.team_name.toLowerCase().includes(search.toLowerCase());
  });
}
