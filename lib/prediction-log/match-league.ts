import { LEAGUE_OPTIONS } from "./markets-config";
import type { LogMatch, PredictionBatch } from "./types";

const DEFAULT_LEAGUE = LEAGUE_OPTIONS[0];

/** Effective league for a match (per-match override, then batch fallback). */
export function matchLeague(match: LogMatch, batchLeague?: string): string {
  const fromMatch = match.league?.trim();
  if (fromMatch) return fromMatch;
  const fromBatch = batchLeague?.trim();
  if (fromBatch && fromBatch !== "Mixed") return fromBatch;
  return DEFAULT_LEAGUE;
}

/** Derive batch-level league label from match rows. */
export function deriveBatchLeague(matches: LogMatch[], fallback?: string): string {
  const leagues = matches
    .map((m) => m.league?.trim())
    .filter((l): l is string => Boolean(l));
  if (leagues.length === 0) {
    const fb = fallback?.trim();
    return fb && fb !== "Mixed" ? fb : DEFAULT_LEAGUE;
  }
  const unique = [...new Set(leagues)];
  if (unique.length === 1) return unique[0]!;
  return "Mixed";
}

/** Human-readable league label for batch list headers. */
export function batchLeagueDisplay(batch: PredictionBatch): string {
  const derived = deriveBatchLeague(batch.matches, batch.league);
  if (derived !== "Mixed") return derived;
  const unique = [...new Set(batch.matches.map((m) => matchLeague(m, batch.league)))];
  if (unique.length <= 3) return unique.join(" + ");
  return `Mixed (${unique.length} leagues)`;
}

/** Ensure each match has a league (migrate legacy batches). */
export function normalizeMatchLeagues(
  matches: LogMatch[],
  batchLeague?: string
): LogMatch[] {
  const fallback = batchLeague && batchLeague !== "Mixed" ? batchLeague : DEFAULT_LEAGUE;
  return matches.map((m) => ({
    ...m,
    league: m.league?.trim() || fallback,
  }));
}

/** Short labels for compact per-row league selects. */
export const LEAGUE_SHORT_LABELS: Record<string, string> = {
  "Premier League": "PL",
  "La Liga": "La Liga",
  "Serie A": "Serie A",
  "Bundesliga": "BL",
  "Ligue 1": "L1",
  "UEFA Champions League": "UCL",
  "UEFA Europa League": "UEL",
  "UEFA Europa Conference League": "UECL",
};

export function leagueShortLabel(league: string): string {
  return LEAGUE_SHORT_LABELS[league] ?? league;
}
