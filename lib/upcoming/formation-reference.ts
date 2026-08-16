/**
 * Formation trace for upcoming fixtures — reference only (does not feed CFE/HSH).
 */
import { findClubInIndex } from "@/lib/prediction-log/club-index";
import type { ClubIndex, ClubRecord } from "@/lib/prediction-log/club-record-types";
import { computeLineupContextSignal } from "@/lib/prediction-log/lineup-context";
import { matchLeague } from "@/lib/prediction-log/match-league";
import type { LogMatch, MatchLineups } from "@/lib/prediction-log/types";

export type FormationHistoryEntry = {
  date: string;
  formation?: string;
  opponent: string;
  xiSize: number;
};

export type FormationTraceSide = {
  team: string;
  /** Published pre-match formation from API-Football (when available). */
  announced?: string;
  /** Most common formation in recent settled matches. */
  typical?: string;
  recent: FormationHistoryEntry[];
  announcedXi?: string[];
  stabilityLabel: "stable" | "mixed" | "unknown";
};

export type FormationReference = {
  matchId: string;
  apiFixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoff?: string;
  home: FormationTraceSide;
  away: FormationTraceSide;
  /** Advisory lineup stability 0–100 (from club history; 0 when insufficient data). */
  lineupStabilityPct: number | null;
  source: "api" | "history" | "mixed" | "none";
  referenceNote: string;
};

function modeFormation(formations: (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const f of formations) {
    const k = f?.trim();
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [f, n] of counts) {
    if (n > bestN) {
      best = f;
      bestN = n;
    }
  }
  return best;
}

function resolveClubRecord(
  team: string,
  league: string,
  clubIndex: ClubIndex | null,
  clubRecords: Record<string, ClubRecord>
): ClubRecord | null {
  if (!clubIndex) return null;
  const entry = findClubInIndex(clubIndex, team, league);
  if (!entry) return null;
  return clubRecords[entry.clubId] ?? null;
}

function traceSide(
  team: string,
  league: string,
  announced: MatchLineups["home"] | undefined,
  clubIndex: ClubIndex | null,
  clubRecords: Record<string, ClubRecord>
): FormationTraceSide {
  const record = resolveClubRecord(team, league, clubIndex, clubRecords);
  const snaps = record?.recentLineups ?? [];
  const recent: FormationHistoryEntry[] = snaps
    .slice(-5)
    .reverse()
    .map((s) => ({
      date: s.date,
      formation: s.formation,
      opponent: s.opponentId,
      xiSize: s.starting.length,
    }));

  const typical = modeFormation(snaps.map((s) => s.formation));
  const announcedFormation = announced?.formation?.trim() || undefined;

  let stabilityLabel: FormationTraceSide["stabilityLabel"] = "unknown";
  if (snaps.length >= 2) {
    const lastTwo = snaps.slice(-2);
    const sameForm =
      lastTwo[0]?.formation &&
      lastTwo[1]?.formation &&
      lastTwo[0].formation === lastTwo[1].formation;
    stabilityLabel = sameForm ? "stable" : "mixed";
  } else if (snaps.length === 1) {
    stabilityLabel = "mixed";
  }

  if (announcedFormation && typical && announcedFormation === typical) {
    stabilityLabel = "stable";
  } else if (announcedFormation && typical && announcedFormation !== typical) {
    stabilityLabel = "mixed";
  }

  return {
    team,
    announced: announcedFormation,
    typical,
    recent,
    announcedXi: announced?.starting?.length ? announced.starting : undefined,
    stabilityLabel,
  };
}

function buildReferenceNote(ref: Pick<FormationReference, "home" | "away" | "source">): string {
  const parts: string[] = [];
  if (ref.source === "api" || ref.source === "mixed") {
    parts.push("Pre-match lineups published by API-Football.");
  }
  if (ref.source === "history" || ref.source === "mixed") {
    parts.push("Typical formation traced from recent settled batches in Prediction Log.");
  }
  if (ref.source === "none") {
    return "No announced lineups yet and no formation history in club records — check closer to kickoff.";
  }
  if (ref.home.announced && ref.home.typical && ref.home.announced !== ref.home.typical) {
    parts.push(`${ref.home.team} announced ${ref.home.announced} vs usual ${ref.home.typical}.`);
  }
  if (ref.away.announced && ref.away.typical && ref.away.announced !== ref.away.typical) {
    parts.push(`${ref.away.team} announced ${ref.away.announced} vs usual ${ref.away.typical}.`);
  }
  parts.push("Reference only — does not change Half Goals, Total Goals, or Ladder probabilities.");
  return parts.join(" ");
}

export function buildFormationReference(
  match: LogMatch,
  batchLeague: string,
  opts: {
    apiLineups?: MatchLineups | null;
    clubIndex: ClubIndex | null;
    clubRecords: Record<string, ClubRecord>;
    kickoff?: string;
  }
): FormationReference {
  const league = matchLeague(match, batchLeague);
  const api = opts.apiLineups ?? undefined;

  const home = traceSide(match.homeTeam, league, api?.home, opts.clubIndex, opts.clubRecords);
  const away = traceSide(match.awayTeam, league, api?.away, opts.clubIndex, opts.clubRecords);

  const hasApi = Boolean(home.announced || away.announced || home.announcedXi?.length);
  const hasHist = Boolean(home.recent.length || away.recent.length || home.typical || away.typical);

  let source: FormationReference["source"] = "none";
  if (hasApi && hasHist) source = "mixed";
  else if (hasApi) source = "api";
  else if (hasHist) source = "history";

  const homeRec = resolveClubRecord(match.homeTeam, league, opts.clubIndex, opts.clubRecords);
  const awayRec = resolveClubRecord(match.awayTeam, league, opts.clubIndex, opts.clubRecords);
  const stability = computeLineupContextSignal(homeRec, awayRec);
  const lineupStabilityPct =
    stability.reliability > 0 ? Math.round(stability.value * 100) : null;

  const ref: FormationReference = {
    matchId: match.id,
    apiFixtureId: match.apiFixtureId ?? 0,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    league,
    kickoff: opts.kickoff,
    home,
    away,
    lineupStabilityPct,
    source,
    referenceNote: "",
  };
  ref.referenceNote = buildReferenceNote(ref);
  return ref;
}
