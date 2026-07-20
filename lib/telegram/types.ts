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
  | "await_league"
  | "await_home"
  | "await_away"
  | "await_date"
  | "await_another"
  | "await_decision_pick";

export interface TelegramDraftMatch {
  homeTeam: string;
  awayTeam: string;
  league: string;
  date: string;
}

export interface TelegramSession {
  step: TelegramSessionStep;
  draftBatchName?: string;
  draftLeague?: string;
  draftHome?: string;
  draftMatches: TelegramDraftMatch[];
  updatedAt: string;
}
