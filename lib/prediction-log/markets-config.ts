import type { LogMarketKey, MarketPrediction } from "./types";

export type MarketKind = "categorical" | "numeric";

export interface LogMarketDef {
  key: LogMarketKey;
  label: string;
  kind: MarketKind;
  defaultLine?: number;
  lineOptions?: number[];
}

export const LEAGUE_OPTIONS = [
  "Premier League",
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "UEFA Champions League",
  "UEFA Europa League",
  "UEFA Europa Conference League",
] as const;

export type LeagueOption = (typeof LEAGUE_OPTIONS)[number];

export const LOG_MARKETS: LogMarketDef[] = [
  { key: "1x2", label: "Match result (1X2)", kind: "categorical" },
  { key: "double_chance", label: "Double chance", kind: "categorical" },
  { key: "btts", label: "Both teams to score", kind: "categorical" },
  {
    key: "home_goals_ou",
    label: "Home team goals O/U",
    kind: "numeric",
    defaultLine: 0.5,
    lineOptions: [0.5, 1.5, 2.5],
  },
  {
    key: "away_goals_ou",
    label: "Away team goals O/U",
    kind: "numeric",
    defaultLine: 0.5,
    lineOptions: [0.5, 1.5, 2.5],
  },
  { key: "ht_1x2", label: "First half result", kind: "categorical" },
  { key: "more_goals_half", label: "More goals (1H vs 2H)", kind: "categorical" },
  { key: "draw_one_half", label: "Draw at least one half", kind: "categorical" },
  { key: "win_one_half", label: "Win at least one half", kind: "categorical" },
  {
    key: "shots_ou",
    label: "Total shots O/U",
    kind: "numeric",
    defaultLine: 20.5,
    lineOptions: [20.5, 25.5],
  },
  {
    key: "home_shots_ou",
    label: "Home team shots O/U",
    kind: "numeric",
    defaultLine: 10.5,
    lineOptions: [10.5, 12.5],
  },
  {
    key: "away_shots_ou",
    label: "Away team shots O/U",
    kind: "numeric",
    defaultLine: 10.5,
    lineOptions: [10.5, 12.5],
  },
  {
    key: "sot_ou",
    label: "Shots on target O/U",
    kind: "numeric",
    defaultLine: 4.5,
    lineOptions: [3.5, 4.5, 5.5],
  },
  {
    key: "corners_ou",
    label: "Total corners O/U",
    kind: "numeric",
    defaultLine: 9.5,
    lineOptions: [8.5, 9.5, 10.5],
  },
  {
    key: "throw_ins_ou",
    label: "Total throw-ins O/U",
    kind: "numeric",
    defaultLine: 38.5,
    lineOptions: [35.5, 38.5, 41.5],
  },
  {
    key: "offsides_ou",
    label: "Total offsides O/U",
    kind: "numeric",
    defaultLine: 4.5,
    lineOptions: [3.5, 4.5, 5.5],
  },
];

export const LOG_MARKET_MAP = Object.fromEntries(
  LOG_MARKETS.map((m) => [m.key, m])
) as Record<LogMarketKey, LogMarketDef>;

export function defaultPrediction(key: LogMarketKey): MarketPrediction {
  const def = LOG_MARKET_MAP[key];
  switch (key) {
    case "1x2":
    case "ht_1x2":
      return { prediction: "home", confidence: 50 };
    case "double_chance":
      return { prediction: "1x", confidence: 50 };
    case "btts":
    case "draw_one_half":
      return { prediction: "yes", confidence: 50 };
    case "more_goals_half":
      return { prediction: "first_half", confidence: 50 };
    case "win_one_half":
      return { prediction: "home", confidence: 50 };
    default:
      return {
        prediction: "over",
        line: def.defaultLine ?? 2.5,
        confidence: 50,
      };
  }
}

export function pickOptionsForMarket(
  key: LogMarketKey,
  home: string,
  away: string,
  line?: number
): { value: string; label: string }[] {
  const short = (n: string, max = 10) =>
    n.length > max ? `${n.slice(0, max - 1)}…` : n;

  switch (key) {
    case "1x2":
    case "ht_1x2":
      return [
        { value: "home", label: short(home) || "Home" },
        { value: "draw", label: "Draw" },
        { value: "away", label: short(away) || "Away" },
      ];
    case "double_chance":
      return [
        { value: "1x", label: "1X" },
        { value: "x2", label: "X2" },
        { value: "12", label: "12" },
      ];
    case "btts":
    case "draw_one_half":
      return [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ];
    case "more_goals_half":
      return [
        { value: "first_half", label: "1st half" },
        { value: "second_half", label: "2nd half" },
        { value: "equal", label: "Equal" },
      ];
    case "win_one_half":
      return [
        { value: "home", label: short(home) || "Home" },
        { value: "away", label: short(away) || "Away" },
      ];
    default:
      return [
        { value: "over", label: `Over ${line ?? "?"}` },
        { value: "under", label: `Under ${line ?? "?"}` },
      ];
  }
}

export function actualOptionsForMarket(
  key: LogMarketKey,
  home: string,
  away: string
): { value: string; label: string }[] | null {
  const def = LOG_MARKET_MAP[key];
  if (def.kind === "numeric") return null;
  return pickOptionsForMarket(key, home, away);
}
