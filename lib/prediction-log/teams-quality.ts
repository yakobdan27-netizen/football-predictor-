import type { LogMarketKey, LeagueCharacterProfile } from "./types";
import type {
  QualityTier,
  TeamQualityRecord,
  TeamsQualityStore,
  TierMatchInfo,
} from "./teams-quality-types";
import { tierBoostScaleFromLeague } from "./league-character";

export const TIER_RANK: Record<QualityTier, number> = {
  A: 4,
  B: 3,
  C: 2,
  D: 1,
};

export const DEFAULT_TIER_CONFIG: TeamsQualityStore["tier_config"] = {
  A: { rank: 4, label: "Elite", color: "#d4af37" },
  B: { rank: 3, label: "Strong", color: "#c0c0c0" },
  C: { rank: 2, label: "Average", color: "#cd7f32" },
  D: { rank: 1, label: "Below Average", color: "#9ca3af" },
};

export function emptyTeamsQualityStore(): TeamsQualityStore {
  return {
    teams: [],
    tier_config: { ...DEFAULT_TIER_CONFIG },
    boost_per_tier_gap: 0.05,
    max_boost: 0.15,
    last_updated: new Date().toISOString(),
  };
}

export function normalizeStore(raw: TeamsQualityStore): TeamsQualityStore {
  const tier_config = { ...DEFAULT_TIER_CONFIG, ...raw.tier_config };
  const teams = (raw.teams ?? []).map((team) => normalizeTeamRecord(team, tier_config));
  return {
    teams,
    tier_config,
    boost_per_tier_gap: raw.boost_per_tier_gap ?? 0.05,
    max_boost: raw.max_boost ?? 0.15,
    last_updated: raw.last_updated ?? new Date().toISOString(),
  };
}

export function teamNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function slugifyTeamId(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function qualityLabelForTier(
  tier: QualityTier,
  tierConfig: TeamsQualityStore["tier_config"] = DEFAULT_TIER_CONFIG
): string {
  return tierConfig[tier]?.label ?? tier;
}

export function normalizeTeamRecord(
  team: Partial<TeamQualityRecord> & { team_name: string; tier: QualityTier },
  tierConfig: TeamsQualityStore["tier_config"] = DEFAULT_TIER_CONFIG
): TeamQualityRecord {
  const now = new Date().toISOString();
  const tier = team.tier;
  return {
    team_id: team.team_id ?? slugifyTeamId(team.team_name),
    team_name: team.team_name.trim(),
    tier,
    tier_rank: tierConfig[tier]?.rank ?? TIER_RANK[tier],
    quality_description:
      team.quality_description ?? qualityLabelForTier(tier, tierConfig),
    created_at: team.created_at ?? now,
    updated_at: now,
    manual_override: true,
    club_id: team.club_id,
  };
}

export function buildTeamLookup(
  store: TeamsQualityStore | null | undefined
): Map<string, TeamQualityRecord> {
  const map = new Map<string, TeamQualityRecord>();
  if (!store) return map;
  for (const team of store.teams) {
    map.set(teamNameKey(team.team_name), team);
    map.set(team.team_id, team);
  }
  return map;
}

export function lookupTeam(
  store: TeamsQualityStore | null | undefined,
  teamName: string
): TeamQualityRecord | null {
  if (!store) return null;
  const key = teamNameKey(teamName);
  return buildTeamLookup(store).get(key) ?? null;
}

export function tierBoostPercent(
  homeRank: number | null,
  awayRank: number | null,
  boostPerGap = 0.05,
  maxBoost = 0.15
): number {
  if (homeRank == null || awayRank == null) return 0;
  const gap = Math.abs(homeRank - awayRank);
  if (gap === 0) return 0;
  const raw = gap * boostPerGap * 100;
  return Math.min(raw, maxBoost * 100);
}

export function boostVsDLabel(tier: QualityTier, store: TeamsQualityStore): string {
  const rank = TIER_RANK[tier];
  const gapToD = rank - 1;
  if (gapToD <= 0) return "baseline";
  const pct = tierBoostPercent(rank, 1, store.boost_per_tier_gap, store.max_boost);
  return `+${pct}% vs D`;
}

export type PickSide = "home" | "away" | "neutral";

export function inferPickSide(marketKey: LogMarketKey, prediction: string): PickSide {
  const p = prediction.toLowerCase().trim();

  if (marketKey === "1x2" || marketKey === "ht_1x2") {
    if (p === "home" || p === "1" || p === "h") return "home";
    if (p === "away" || p === "2" || p === "a") return "away";
    return "neutral";
  }

  if (marketKey === "double_chance") {
    if (p === "1x" || p === "12" || p.startsWith("1")) return "home";
    if (p === "x2" || p.endsWith("2")) return "away";
    return "neutral";
  }

  if (marketKey === "home_goals_ou") return "home";
  if (marketKey === "away_goals_ou") return "away";

  if (marketKey === "win_one_half") {
    if (p.includes("home")) return "home";
    if (p.includes("away")) return "away";
  }

  return "neutral";
}

export function tierDirection(
  homeRank: number | null,
  awayRank: number | null,
  pickSide: PickSide
): -1 | 0 | 1 {
  if (homeRank == null || awayRank == null || pickSide === "neutral") return 0;
  if (homeRank === awayRank) return 0;

  const higherIsHome = homeRank > awayRank;
  const pickedHigher =
    (higherIsHome && pickSide === "home") || (!higherIsHome && pickSide === "away");
  const pickedLower =
    (higherIsHome && pickSide === "away") || (!higherIsHome && pickSide === "home");

  if (pickedHigher) return 1;
  if (pickedLower) return -1;
  return 0;
}

function clampPFinal(n: number): number {
  return Math.max(5, Math.min(95, Math.round(n)));
}

export function applyTierBoostToPFinal(
  pFinalBase: number,
  homeTeam: string,
  awayTeam: string,
  marketKey: LogMarketKey,
  prediction: string,
  store: TeamsQualityStore | null | undefined,
  leagueCharacterProfile?: LeagueCharacterProfile | null
): TierMatchInfo {
  const homeRec = lookupTeam(store, homeTeam);
  const awayRec = lookupTeam(store, awayTeam);
  const homeRank = homeRec?.tier_rank ?? null;
  const awayRank = awayRec?.tier_rank ?? null;
  const boostPerGap = store?.boost_per_tier_gap ?? 0.05;
  const maxBoost = store?.max_boost ?? 0.15;

  const tierBoostPct = tierBoostPercent(homeRank, awayRank, boostPerGap, maxBoost);
  const pickSide = inferPickSide(marketKey, prediction);
  const direction = tierDirection(homeRank, awayRank, pickSide);
  const leagueScale = tierBoostScaleFromLeague(leagueCharacterProfile ?? null);
  const appliedBoost = direction !== 0 ? tierBoostPct * direction * leagueScale : 0;
  const pFinalWithTier = clampPFinal(pFinalBase + appliedBoost);

  const higherTierTeam =
    homeRank != null && awayRank != null
      ? homeRank > awayRank
        ? homeTeam
        : awayRank > homeRank
          ? awayTeam
          : null
      : null;

  return {
    homeTier: homeRec?.tier ?? null,
    awayTier: awayRec?.tier ?? null,
    tierGap: homeRank != null && awayRank != null ? Math.abs(homeRank - awayRank) : 0,
    tierBoostPct,
    direction,
    appliedBoost,
    higherTierTeam,
    pFinalBase,
    pFinalWithTier,
  };
}

export function tierSummaryCounts(store: TeamsQualityStore): Record<QualityTier, number> {
  const counts: Record<QualityTier, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const team of store.teams) counts[team.tier]++;
  return counts;
}

export interface ImportRow {
  team_name: string;
  tier: QualityTier;
}

export function parseTeamsImport(text: string): ImportRow[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as
      | { teams?: Array<{ team_name: string; tier: QualityTier }> }
      | Array<{ team_name: string; tier: QualityTier }>;
    const rows = Array.isArray(parsed) ? parsed : parsed.teams ?? [];
    return rows
      .filter((r) => r.team_name && r.tier)
      .map((r) => ({ team_name: r.team_name.trim(), tier: r.tier }));
  }

  const rows: ImportRow[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const row = line.trim();
    if (!row || row.toLowerCase().startsWith("team_name")) continue;
    const [name, tierRaw] = row.split(",").map((s) => s.trim());
    const tier = tierRaw?.toUpperCase() as QualityTier;
    if (!name || !["A", "B", "C", "D"].includes(tier)) continue;
    rows.push({ team_name: name, tier });
  }
  return rows;
}

export function mergeImportedTeams(
  store: TeamsQualityStore,
  rows: ImportRow[],
  mode: "merge" | "replace" = "merge"
): TeamsQualityStore {
  const base = mode === "replace" ? emptyTeamsQualityStore() : { ...store, teams: [...store.teams] };
  const byKey = new Map(base.teams.map((t) => [teamNameKey(t.team_name), t]));

  for (const row of rows) {
    const record = normalizeTeamRecord(
      { team_name: row.team_name, tier: row.tier },
      base.tier_config
    );
    const key = teamNameKey(record.team_name);
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, {
        ...existing,
        tier: record.tier,
        tier_rank: record.tier_rank,
        quality_description: record.quality_description,
        updated_at: record.updated_at,
      });
    } else {
      byKey.set(key, record);
    }
  }

  return normalizeStore({
    ...base,
    teams: [...byKey.values()].sort((a, b) => a.team_name.localeCompare(b.team_name)),
    last_updated: new Date().toISOString(),
  });
}

export function exportTeamsCsv(store: TeamsQualityStore): string {
  const lines = ["team_name,tier"];
  for (const team of store.teams) {
    lines.push(`${team.team_name},${team.tier}`);
  }
  return lines.join("\n");
}
