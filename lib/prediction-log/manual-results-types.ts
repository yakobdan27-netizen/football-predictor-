export interface ManualResultRecord {
  id: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeApiTeamId?: number;
  awayApiTeamId?: number;
  ftHome: number;
  ftAway: number;
  htHome?: number;
  htAway?: number;
  matchDate?: string;
  filledBy: string;
  filledAt: string;
  batchesUpdatedCount: number;
  matchLegsUpdatedCount: number;
}
