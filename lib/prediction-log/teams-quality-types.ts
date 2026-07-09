export type QualityTier = "A" | "B" | "C" | "D";

export interface TierConfigEntry {
  rank: number;
  label: string;
  color: string;
}

export interface TeamQualityRecord {
  team_id: string;
  team_name: string;
  tier: QualityTier;
  tier_rank: number;
  quality_description: string;
  created_at: string;
  updated_at: string;
  manual_override: true;
  club_id?: string;
}

export interface TeamsQualityStore {
  teams: TeamQualityRecord[];
  tier_config: Record<QualityTier, TierConfigEntry>;
  boost_per_tier_gap: number;
  max_boost: number;
  last_updated: string;
}

export interface TierMatchInfo {
  homeTier: QualityTier | null;
  awayTier: QualityTier | null;
  tierGap: number;
  tierBoostPct: number;
  direction: -1 | 0 | 1;
  appliedBoost: number;
  higherTierTeam: string | null;
  pFinalBase: number;
  pFinalWithTier: number;
}
