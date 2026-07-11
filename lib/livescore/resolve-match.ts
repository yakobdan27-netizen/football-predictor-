import { fixturePairKey } from "@/lib/football-api/team-resolve";
import { standardizeTeamName } from "@/lib/data/team-names";

function normKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Parse Livescore event id from a match or stats URL. */
export function parseEventIdFromUrl(url: string): string | null {
  const m = url.match(/\/(\d{5,})\/(?:stats|line-ups|lineups|summary|odds)?\/?/i);
  if (m) return m[1];
  const m2 = url.match(/\/(\d{5,})\/?$/);
  return m2 ? m2[1] : null;
}

/** Normalize batch date (YYYY-MM-DD or DD/MM/YYYY) to YYYYMMDD. */
export function toLivescoreDateKey(date: string): string {
  const trimmed = date.trim();
  if (/^\d{8}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10).replace(/-/g, "");
  }
  const dmy = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, "0");
    const mm = dmy[2].padStart(2, "0");
    let yyyy = dmy[3];
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    return `${yyyy}${mm}${dd}`;
  }
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits.length >= 8) return digits.slice(0, 8);
  throw new Error(`Unrecognized date for Livescore: ${date}`);
}

export function buildStatsUrl(parts: {
  eventId: string;
  homeSlug?: string;
  awaySlug?: string;
  competitionPath?: string;
}): string {
  if (parts.competitionPath && parts.homeSlug && parts.awaySlug) {
    return `https://www.livescore.com/en/football/${parts.competitionPath}/${parts.homeSlug}-vs-${parts.awaySlug}/${parts.eventId}/stats/`;
  }
  return `https://www.livescore.com/en/football/match/${parts.eventId}/stats/`;
}

export function teamNamesMatch(a: string, b: string): boolean {
  const na = standardizeTeamName(a);
  const nb = standardizeTeamName(b);
  if (fixturePairKey(na, "x") === fixturePairKey(nb, "x")) return true;
  const ka = normKey(na);
  const kb = normKey(nb);
  if (ka === kb) return true;
  if (ka.length >= 4 && kb.length >= 4 && (ka.includes(kb) || kb.includes(ka))) return true;
  return false;
}

export function competitionHintMatch(
  stageName: string | undefined,
  competition?: string
): boolean {
  if (!competition?.trim()) return true;
  if (!stageName) return true;
  const a = normKey(stageName);
  const b = normKey(competition);
  if (!a || !b) return true;
  return a.includes(b) || b.includes(a);
}

export interface DateFeedEvent {
  Eid: string | number;
  Eps?: string;
  Esd?: string | number;
  T1?: Array<{ Nm?: string }>;
  T2?: Array<{ Nm?: string }>;
}

export interface DateFeedStage {
  CompN?: string;
  Snm?: string;
  Sid?: string | number;
  Events?: DateFeedEvent[];
}

/** Find best event id for home/away on a date feed. */
export function findEventInDateFeed(
  stages: DateFeedStage[],
  homeTeam: string,
  awayTeam: string,
  competition?: string
): { eventId: string; competition?: string; status?: string } | null {
  const candidates: Array<{
    eventId: string;
    competition?: string;
    status?: string;
    score: number;
  }> = [];

  for (const stage of stages) {
    const stageLabel = stage.CompN || stage.Snm || "";
    const compBonus = competitionHintMatch(stageLabel, competition) ? 2 : 0;
    for (const ev of stage.Events ?? []) {
      const home = ev.T1?.[0]?.Nm ?? "";
      const away = ev.T2?.[0]?.Nm ?? "";
      if (!home || !away) continue;
      const homeOk = teamNamesMatch(home, homeTeam);
      const awayOk = teamNamesMatch(away, awayTeam);
      if (!homeOk || !awayOk) continue;
      let score = 10 + compBonus;
      const status = (ev.Eps ?? "").toUpperCase();
      if (status === "FT" || status === "AET" || status === "AP") score += 3;
      candidates.push({
        eventId: String(ev.Eid),
        competition: stageLabel || undefined,
        status: ev.Eps,
        score,
      });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return {
    eventId: best.eventId,
    competition: best.competition,
    status: best.status,
  };
}
