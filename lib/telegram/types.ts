import type { LogMarketKey } from "@/lib/prediction-log/types";

export type TelegramUserStatus = "active" | "blocked";
export type TelegramUserRole = "external_user";

export interface TelegramUser {
  id: string;
  telegramId: string;
  username: string | null;
  displayName: string;
  status: TelegramUserStatus;
  role: TelegramUserRole;
  createdAt: string;
}

export type TelegramSessionStep =
  | "idle"
  | "await_batch_name"
  | "await_batch_date"
  | "await_league"
  | "await_home"
  | "await_away"
  | "await_market"
  | "await_line"
  | "await_pick"
  | "await_odds"
  | "await_another"
  | "await_confirm_batch"
  | "await_decision_pick";

export interface TelegramDraftMatch {
  homeTeam: string;
  awayTeam: string;
  league: string;
  date: string;
  marketKey?: LogMarketKey;
  prediction?: string;
  line?: number;
  odds?: number;
  confidence?: number;
}

export interface TelegramSession {
  step: TelegramSessionStep;
  draftBatchName?: string;
  /** Shared date applied to every match in this batch. */
  draftBatchDate?: string;
  draftMatches: TelegramDraftMatch[];
  /** In-progress match (before odds confirm). */
  draftLeague?: string;
  draftHome?: string;
  draftAway?: string;
  draftMarketKey?: LogMarketKey;
  draftLine?: number;
  draftPrediction?: string;
  /** Pagination for team / market lists. */
  listPage?: number;
  /** A–Z filter for large league rosters (UEFA). */
  teamLetter?: string;
  /** When true, next typed number is custom odds. */
  awaitingCustomOdds?: boolean;
  updatedAt: string;
}
