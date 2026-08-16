/**
 * Parse API-Football GET /fixtures/lineups response → MatchLineups.
 */
import type { MatchLineups, MatchSideLineup } from "@/lib/prediction-log/types";

type AfPlayerRow = {
  player?: {
    id?: number | null;
    name?: string | null;
    number?: number | null;
  } | null;
};

type AfLineupTeamRow = {
  team?: { id?: number | null; name?: string | null } | null;
  formation?: string | null;
  startXI?: AfPlayerRow[] | null;
  substitutes?: AfPlayerRow[] | null;
};

function playerNames(rows: AfPlayerRow[] | null | undefined): string[] {
  if (!Array.isArray(rows)) return [];
  const out: string[] = [];
  for (const row of rows) {
    const name = row.player?.name?.trim();
    if (name) out.push(name);
  }
  return out;
}

function mapSide(row: AfLineupTeamRow | undefined): MatchSideLineup {
  if (!row) {
    return { starting: [], substitutes: [] };
  }
  const formation = row.formation?.trim() || undefined;
  return {
    starting: playerNames(row.startXI),
    substitutes: playerNames(row.substitutes),
    formation,
  };
}

/**
 * Map AF lineups payload to home/away using optional team ids (falls back to row order).
 */
export function parseApiFootballLineups(
  rows: unknown[],
  opts?: { homeTeamId?: number | null; awayTeamId?: number | null }
): MatchLineups | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const teams = rows as AfLineupTeamRow[];

  let homeRow: AfLineupTeamRow | undefined;
  let awayRow: AfLineupTeamRow | undefined;

  const homeId = opts?.homeTeamId ?? null;
  const awayId = opts?.awayTeamId ?? null;

  if (homeId != null) {
    homeRow = teams.find((t) => t.team?.id === homeId);
  }
  if (awayId != null) {
    awayRow = teams.find((t) => t.team?.id === awayId);
  }

  if (!homeRow && !awayRow && teams.length >= 2) {
    homeRow = teams[0];
    awayRow = teams[1];
  } else if (!homeRow && teams.length === 1) {
    homeRow = teams[0];
  } else if (!awayRow && teams.length === 2) {
    awayRow = teams.find((t) => t !== homeRow) ?? teams[1];
  }

  const home = mapSide(homeRow);
  const away = mapSide(awayRow);

  if (
    !home.starting.length &&
    !away.starting.length &&
    !home.formation &&
    !away.formation
  ) {
    return undefined;
  }

  return { home, away };
}
