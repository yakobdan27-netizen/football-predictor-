import type { MatchLineups } from "@/lib/prediction-log/types";

/** Raw scraped payload before mapping into LogMatch. */
export interface LivescoreSideStats {
  goals?: number;
  firstHalfGoals?: number;
  possession?: number;
  totalShots?: number;
  shotsOnTarget?: number;
  corners?: number;
  fouls?: number;
  yellowCards?: number;
  redCards?: number;
  throwIns?: number;
  offsides?: number;
}

export interface LivescoreScrapeResult {
  eventId: string;
  url: string;
  homeTeam: string;
  awayTeam: string;
  competition?: string;
  matchDate?: string;
  status?: string;
  home: LivescoreSideStats;
  away: LivescoreSideStats;
  goalInFirst10?: boolean;
  firstGoalSide?: "home" | "away" | "none";
  lineups?: MatchLineups;
  scrapedAt: string;
}

export interface ResolveMatchInput {
  homeTeam: string;
  awayTeam: string;
  date: string;
  competition?: string;
  livescoreUrl?: string;
  livescoreEventId?: string;
}
