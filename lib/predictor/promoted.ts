import type { MatchRow } from "./types";

export interface DixonColesLike {
  teams: string[];
  attack: Record<string, number>;
  defence: Record<string, number>;
  homeAdv: number;
  rho: number;
}

export function getMatchCount(team: string, rows: MatchRow[]): number {
  return rows.filter((r) => r.HomeTeam === team || r.AwayTeam === team).length;
}

export function isPromotedTeam(
  team: string,
  rows: MatchRow[],
  minMatches = 6
): boolean {
  return getMatchCount(team, rows) < minMatches;
}

function leagueMeanStrength(model: DixonColesLike): {
  attack: number;
  defence: number;
} {
  const n = model.teams.length || 1;
  const attack =
    model.teams.reduce((s, t) => s + model.attack[t], 0) / n;
  const defence =
    model.teams.reduce((s, t) => s + model.defence[t], 0) / n;
  return { attack, defence };
}

export function withPromotedFallback(
  model: DixonColesLike,
  home: string,
  away: string,
  rows: MatchRow[],
  minMatches = 6
): { model: DixonColesLike; warnings: string[] } {
  const warnings: string[] = [];
  const mean = leagueMeanStrength(model);
  const adjusted: DixonColesLike = {
    homeAdv: model.homeAdv,
    rho: model.rho,
    teams: [...model.teams],
    attack: { ...model.attack },
    defence: { ...model.defence },
  };

  for (const team of [home, away]) {
    if (!adjusted.teams.includes(team)) {
      adjusted.teams.push(team);
      adjusted.attack[team] = mean.attack;
      adjusted.defence[team] = mean.defence;
      warnings.push(`${team}: promoted fallback (not in training data)`);
    } else if (isPromotedTeam(team, rows, minMatches)) {
      adjusted.attack[team] = mean.attack;
      adjusted.defence[team] = mean.defence;
      warnings.push(`${team}: promoted fallback (< ${minMatches} matches)`);
    }
  }

  return { model: adjusted, warnings };
}
