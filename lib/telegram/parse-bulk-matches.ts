import type { TelegramDraftMatch } from "@/lib/telegram/types";
import {
  isValidIsoDate,
  listLeagues,
  resolveFixtureAcrossLeagues,
  resolveTeamInput,
} from "@/lib/telegram/team-resolve";

export const TELEGRAM_MAX_BATCH_MATCHES = 20;

export interface BulkParseOk {
  ok: true;
  matches: TelegramDraftMatch[];
  warnings: string[];
}

export interface BulkParseErr {
  ok: false;
  errors: string[];
}

export type BulkParseResult = BulkParseOk | BulkParseErr;

/**
 * Parse one message with up to 20 matches (mixed leagues).
 *
 * Supported line shapes (date/league optional when defaults provided):
 * - Home vs Away
 * - Home - Away
 * - Home, Away
 * - Home	Away
 * - Home vs Away | League
 * - Home vs Away, League
 * - Home vs Away | League | YYYY-MM-DD
 * - YYYY-MM-DD Home vs Away
 */
export function parseBulkMatchText(
  text: string,
  defaults: { date?: string; league?: string } = {}
): BulkParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { ok: false, errors: ["Send at least one match line."] };
  }
  if (lines.length > TELEGRAM_MAX_BATCH_MATCHES) {
    return {
      ok: false,
      errors: [
        `Too many lines (${lines.length}). Max is ${TELEGRAM_MAX_BATCH_MATCHES} matches per batch.`,
      ],
    };
  }

  const matches: TelegramDraftMatch[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const leagues = listLeagues();

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const parsed = parseOneLine(lines[i]!, leagues);
    if (!parsed.home || !parsed.away) {
      errors.push(
        `Line ${lineNo}: could not read teams. Use "Home vs Away" (optional "| League").`
      );
      continue;
    }

    const date = parsed.date || defaults.date || "";
    if (date && !isValidIsoDate(date)) {
      errors.push(`Line ${lineNo}: invalid date "${date}". Use YYYY-MM-DD.`);
      continue;
    }

    const leagueHint = parsed.league || defaults.league;
    let home: string | null = null;
    let away: string | null = null;
    let league: string | null = null;

    if (leagueHint) {
      const leagueMatch = matchLeagueName(leagueHint, leagues);
      if (!leagueMatch) {
        errors.push(
          `Line ${lineNo}: unknown league "${leagueHint}". Use one of: ${leagues.join(", ")}.`
        );
        continue;
      }
      const hr = resolveTeamInput(leagueMatch, parsed.home);
      const ar = resolveTeamInput(leagueMatch, parsed.away);
      if (!hr.match || !ar.match) {
        const bad = !hr.match ? parsed.home : parsed.away;
        const tips = (!hr.match ? hr.suggestions : ar.suggestions).slice(0, 5);
        errors.push(
          `Line ${lineNo}: couldn't match "${bad}" in ${leagueMatch}.${
            tips.length ? ` Try: ${tips.join(", ")}` : ""
          }`
        );
        continue;
      }
      if (hr.match === ar.match) {
        errors.push(`Line ${lineNo}: home and away must differ.`);
        continue;
      }
      home = hr.match;
      away = ar.match;
      league = leagueMatch;
    } else {
      const resolved = resolveFixtureAcrossLeagues(parsed.home, parsed.away);
      if (!resolved) {
        errors.push(
          `Line ${lineNo}: couldn't resolve "${parsed.home}" vs "${parsed.away}". Add "| League" on the line.`
        );
        continue;
      }
      home = resolved.homeTeam;
      away = resolved.awayTeam;
      league = resolved.league;
      if (resolved.ambiguous) {
        warnings.push(
          `Line ${lineNo}: used ${league} for ${home} vs ${away} (also matched elsewhere).`
        );
      }
    }

    matches.push({ homeTeam: home, awayTeam: away, league, date });
  }

  if (errors.length) return { ok: false, errors };
  if (!matches.length) {
    return { ok: false, errors: ["No valid matches found."] };
  }
  return { ok: true, matches, warnings };
}

function matchLeagueName(input: string, leagues: string[]): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  const exact = leagues.find((l) => l.toLowerCase() === raw);
  if (exact) return exact;
  const aliases: Record<string, string> = {
    pl: "Premier League",
    epl: "Premier League",
    premier: "Premier League",
    "la liga": "La Liga",
    laliga: "La Liga",
    "serie a": "Serie A",
    seriea: "Serie A",
    bundesliga: "Bundesliga",
    "ligue 1": "Ligue 1",
    ligue1: "Ligue 1",
    ucl: "UEFA Champions League",
    cl: "UEFA Champions League",
    champions: "UEFA Champions League",
    uel: "UEFA Europa League",
    europa: "UEFA Europa League",
    uecl: "UEFA Europa Conference League",
    conference: "UEFA Europa Conference League",
  };
  if (aliases[raw]) return aliases[raw]!;
  const partial = leagues.filter((l) => {
    const lk = l.toLowerCase();
    return lk.includes(raw) || raw.includes(lk);
  });
  return partial.length === 1 ? partial[0]! : null;
}

function parseOneLine(
  line: string,
  leagues: string[]
): { home: string | null; away: string | null; league?: string; date?: string } {
  let rest = line.trim();
  let date: string | undefined;
  let league: string | undefined;

  const leadingDate = rest.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
  if (leadingDate) {
    date = leadingDate[1];
    rest = leadingDate[2]!.trim();
  }

  // Trailing | League | date  or  | League  or  | date
  const pipeParts = rest.split("|").map((p) => p.trim()).filter(Boolean);
  if (pipeParts.length >= 2) {
    rest = pipeParts[0]!;
    for (let i = 1; i < pipeParts.length; i++) {
      const part = pipeParts[i]!;
      if (isValidIsoDate(part)) {
        date = part;
        continue;
      }
      const lg = matchLeagueName(part, leagues);
      if (lg) league = lg;
      else if (!league) league = part; // keep raw for error messaging
    }
  } else {
    // Trailing ", League" when league name is known
    for (const lg of leagues) {
      const suffix = new RegExp(
        `[,;]\\s*${escapeRegExp(lg)}\\s*$`,
        "i"
      );
      if (suffix.test(rest)) {
        league = lg;
        rest = rest.replace(suffix, "").trim();
        break;
      }
    }
    const trailingDate = rest.match(/^(.+?)[,;\s]+(\d{4}-\d{2}-\d{2})\s*$/);
    if (trailingDate) {
      rest = trailingDate[1]!.trim();
      date = trailingDate[2];
    }
  }

  const teams = splitTeams(rest);
  return {
    home: teams?.home ?? null,
    away: teams?.away ?? null,
    league,
    date,
  };
}

function splitTeams(
  rest: string
): { home: string; away: string } | null {
  const vs = rest.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  if (vs) return { home: vs[1]!.trim(), away: vs[2]!.trim() };

  const dash = rest.match(/^(.+?)\s+[–—-]\s+(.+)$/);
  if (dash) return { home: dash[1]!.trim(), away: dash[2]!.trim() };

  if (rest.includes("\t")) {
    const parts = rest.split("\t").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) return { home: parts[0]!, away: parts[1]! };
  }

  if (rest.includes(",")) {
    const parts = rest.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) return { home: parts[0]!, away: parts[1]! };
  }

  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatBulkPreview(
  batchName: string,
  matches: TelegramDraftMatch[],
  warnings: string[] = []
): string {
  const lines = matches.map(
    (m, i) =>
      `${i + 1}. ${m.homeTeam} vs ${m.awayTeam} — ${m.league} — ${m.date}`
  );
  const warn =
    warnings.length > 0
      ? `\n\nNotes:\n${warnings.map((w) => `• ${w}`).join("\n")}`
      : "";
  return (
    `Preview: *${escapeMarkdown(batchName)}* (${matches.length} match${
      matches.length === 1 ? "" : "es"
    })\n\n${lines.join("\n")}${warn}\n\nSave this batch?`
  );
}

function escapeMarkdown(s: string): string {
  return s.replace(/([_*`\[])/g, "\\$1");
}
