import { Markup } from "telegraf";
import {
  LOG_MARKETS,
  marketHasLineOptions,
  pickOptionsForMarket,
  type LogMarketDef,
} from "@/lib/prediction-log/markets-config";
import type { LogMarketKey } from "@/lib/prediction-log/types";
import { listLeagues, listTeams } from "@/lib/telegram/team-resolve";
import { TELEGRAM_MAX_BATCH_MATCHES } from "@/lib/telegram/parse-bulk-matches";

/** Keep callback_data short (Telegram 64-byte limit). */
export const CB = {
  menuCreate: "menu:create",
  menuBatches: "menu:batches",
  menuDecision: "menu:decision",
  menuHelp: "menu:help",
  menuHome: "menu:home",
  dateToday: "date:today",
  confirmSave: "confirm:save",
  confirmCancel: "confirm:cancel",
  anotherYes: "another:yes",
  anotherDone: "another:done",
  league: (i: number) => `lg:${i}`,
  /** Home column (left). */
  teamHome: (i: number) => `home:${i}`,
  /** Away column (right). */
  teamAway: (i: number) => `away:${i}`,
  pageTeams: (p: number) => `tpage:${p}`,
  letterTeams: (ch: string) => `tlet:${ch}`,
  clearLetterTeams: "tlet:_",
  noopAway: "noop:away",
  market: (i: number) => `mk:${i}`,
  pageMarket: (p: number) => `pm:${p}`,
  line: (i: number) => `ln:${i}`,
  pick: (v: string) => `pk:${v}`,
  odds: (v: string) => `od:${v}`,
  oddsCustom: "od:custom",
  decision: (batchId: string) => `decision:${batchId}`,
} as const;

export const TEAM_PAGE_SIZE = 8;
export const MARKET_PAGE_SIZE = 6;
/** Leagues larger than this use A–Z letter filter first. */
export const LETTER_FILTER_THRESHOLD = 30;

export const QUICK_ODDS = [
  "1.40",
  "1.50",
  "1.60",
  "1.70",
  "1.80",
  "1.90",
  "2.00",
  "2.20",
  "2.50",
  "2.80",
] as const;

function btn(text: string, data: string) {
  return Markup.button.callback(truncate(text, 28), data);
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("➕ Create Batch", CB.menuCreate)],
    [Markup.button.callback("📋 My Batches", CB.menuBatches)],
    [Markup.button.callback("🎯 Get Decision", CB.menuDecision)],
    [Markup.button.callback("ℹ️ Help", CB.menuHelp)],
  ]);
}

export function dateKeyboard() {
  const today = new Date().toISOString().slice(0, 10);
  return Markup.inlineKeyboard([
    [Markup.button.callback(`Use today (${today})`, CB.dateToday)],
    [Markup.button.callback("« Menu", CB.menuHome)],
  ]);
}

export function leagueKeyboard() {
  const leagues = listLeagues();
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < leagues.length; i += 2) {
    const row = [btn(leagues[i]!, CB.league(i))];
    if (leagues[i + 1]) row.push(btn(leagues[i + 1]!, CB.league(i + 1)));
    rows.push(row);
  }
  rows.push([Markup.button.callback("« Menu", CB.menuHome)]);
  return Markup.inlineKeyboard(rows);
}

function letterButtons(
  teams: string[]
): ReturnType<typeof Markup.button.callback>[][] {
  const letters = [
    ...new Set(
      teams
        .map((t) => t.trim().charAt(0).toUpperCase())
        .filter((c) => /[A-Z]/.test(c))
    ),
  ].sort();
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < letters.length; i += 6) {
    rows.push(
      letters
        .slice(i, i + 6)
        .map((ch) => Markup.button.callback(ch, CB.letterTeams(ch)))
    );
  }
  return rows;
}

/**
 * One screen: HOME on the left, AWAY on the right (same club list).
 * Tap left to set home, then right to set away.
 */
export function fixtureKeyboard(params: {
  league: string;
  page: number;
  letter?: string;
  selectedHome?: string;
}) {
  const roster = listTeams(params.league);
  const filtered = params.letter
    ? roster.filter((t) => t.toUpperCase().startsWith(params.letter!))
    : roster;
  const useLetters =
    !params.letter &&
    roster.length > LETTER_FILTER_THRESHOLD &&
    filtered.length > TEAM_PAGE_SIZE;

  if (useLetters) {
    const rows = letterButtons(roster);
    rows.push([Markup.button.callback("« Menu", CB.menuHome)]);
    return Markup.inlineKeyboard(rows);
  }

  const page = Math.max(0, params.page);
  const start = page * TEAM_PAGE_SIZE;
  const slice = filtered.slice(start, start + TEAM_PAGE_SIZE);
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];

  for (const team of slice) {
    const idx = roster.indexOf(team);
    if (idx < 0) continue;
    const homeLabel = truncate(`🏠 ${team}`, 28);
    const awayLabel =
      params.selectedHome && team === params.selectedHome
        ? "—"
        : truncate(`✈️ ${team}`, 28);
    const awayData =
      params.selectedHome && team === params.selectedHome
        ? CB.noopAway
        : CB.teamAway(idx);
    rows.push([
      Markup.button.callback(homeLabel, CB.teamHome(idx)),
      Markup.button.callback(awayLabel, awayData),
    ]);
  }

  const nav: ReturnType<typeof Markup.button.callback>[] = [];
  if (page > 0) {
    nav.push(Markup.button.callback("‹ Prev", CB.pageTeams(page - 1)));
  }
  if (start + TEAM_PAGE_SIZE < filtered.length) {
    nav.push(Markup.button.callback("Next ›", CB.pageTeams(page + 1)));
  }
  if (nav.length) rows.push(nav);

  if (params.letter) {
    rows.push([
      Markup.button.callback("All letters", CB.clearLetterTeams),
    ]);
  }

  rows.push([Markup.button.callback("« Menu", CB.menuHome)]);
  return Markup.inlineKeyboard(rows);
}

/** @deprecated use fixtureKeyboard — kept for any residual imports */
export function teamKeyboard(params: {
  league: string;
  side: "home" | "away";
  page: number;
  exclude?: string;
  letter?: string;
}) {
  return fixtureKeyboard({
    league: params.league,
    page: params.page,
    letter: params.letter,
    selectedHome: params.side === "away" ? params.exclude : undefined,
  });
}

export function marketKeyboard(page: number) {
  const p = Math.max(0, page);
  const start = p * MARKET_PAGE_SIZE;
  const slice = LOG_MARKETS.slice(start, start + MARKET_PAGE_SIZE);
  const rows = slice.map((m, i) => [
    btn(m.label, CB.market(start + i)),
  ]);
  const nav: ReturnType<typeof Markup.button.callback>[] = [];
  if (p > 0) nav.push(Markup.button.callback("‹ Prev", CB.pageMarket(p - 1)));
  if (start + MARKET_PAGE_SIZE < LOG_MARKETS.length) {
    nav.push(Markup.button.callback("Next ›", CB.pageMarket(p + 1)));
  }
  if (nav.length) rows.push(nav);
  rows.push([Markup.button.callback("« Menu", CB.menuHome)]);
  return Markup.inlineKeyboard(rows);
}

export function lineKeyboard(def: LogMarketDef) {
  const lines = def.lineOptions ?? [];
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < lines.length; i += 3) {
    const row = lines.slice(i, i + 3).map((line, j) =>
      Markup.button.callback(String(line), CB.line(i + j))
    );
    rows.push(row);
  }
  rows.push([Markup.button.callback("« Menu", CB.menuHome)]);
  return Markup.inlineKeyboard(rows);
}

export function pickKeyboard(
  marketKey: LogMarketKey,
  home: string,
  away: string,
  line?: number
) {
  const opts = pickOptionsForMarket(marketKey, home, away, line);
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < opts.length; i += 2) {
    const row = [btn(opts[i]!.label, CB.pick(opts[i]!.value))];
    if (opts[i + 1]) {
      row.push(btn(opts[i + 1]!.label, CB.pick(opts[i + 1]!.value)));
    }
    rows.push(row);
  }
  rows.push([Markup.button.callback("« Menu", CB.menuHome)]);
  return Markup.inlineKeyboard(rows);
}

export function oddsKeyboard() {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < QUICK_ODDS.length; i += 5) {
    rows.push(
      QUICK_ODDS.slice(i, i + 5).map((o) =>
        Markup.button.callback(o, CB.odds(o))
      )
    );
  }
  rows.push([Markup.button.callback("Type odds…", CB.oddsCustom)]);
  rows.push([Markup.button.callback("« Menu", CB.menuHome)]);
  return Markup.inlineKeyboard(rows);
}

export function anotherKeyboard(count: number) {
  const rows = [
    [
      Markup.button.callback(
        count >= TELEGRAM_MAX_BATCH_MATCHES
          ? `✅ Finish (${count}/${TELEGRAM_MAX_BATCH_MATCHES})`
          : `➕ Add match (${count}/${TELEGRAM_MAX_BATCH_MATCHES})`,
        count >= TELEGRAM_MAX_BATCH_MATCHES ? CB.anotherDone : CB.anotherYes
      ),
    ],
  ];
  if (count > 0 && count < TELEGRAM_MAX_BATCH_MATCHES) {
    rows.push([
      Markup.button.callback(
        `✅ Finish batch (${count})`,
        CB.anotherDone
      ),
    ]);
  }
  rows.push([Markup.button.callback("« Cancel", CB.confirmCancel)]);
  return Markup.inlineKeyboard(rows);
}

export function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Save batch", CB.confirmSave)],
    [Markup.button.callback("« Cancel", CB.confirmCancel)],
  ]);
}

export function batchesKeyboard(
  batches: { id: string; batchName: string; matchCount: number }[]
) {
  const rows = batches.slice(0, 20).map((b) => [
    Markup.button.callback(
      `${truncate(b.batchName, 24)} (${b.matchCount})`,
      CB.decision(b.id)
    ),
  ]);
  rows.push([Markup.button.callback("« Menu", CB.menuHome)]);
  return Markup.inlineKeyboard(rows);
}

export function marketDefAt(index: number): LogMarketDef | null {
  return LOG_MARKETS[index] ?? null;
}

export function needsLine(key: LogMarketKey): boolean {
  const def = LOG_MARKETS.find((m) => m.key === key);
  return !!def && marketHasLineOptions(def);
}

export function matchProgressLabel(n: number): string {
  return `Match ${n + 1} of ${TELEGRAM_MAX_BATCH_MATCHES}`;
}
