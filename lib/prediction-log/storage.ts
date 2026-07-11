import type {
  AnalysisHistory,
  PredictionBatch,
  RecommendationSettings,
  CombinedOddsSettings,
  ClubProfilesStore,
  LearnerStatsStore,
  LuckyNumbersStore,
  TeamCharacteristicsStore,
  LeagueProfilesStore,
} from "./types";
import { LUCKY_NUMBERS_KEY, emptyLuckyNumbersStore } from "./lucky-numbers";
import { SCHEMA_VERSION } from "./types";
import { defaultRecommendationSettings } from "./recommendation-config";
import {
  defaultCombinedOddsSettings,
  loadCombinedOddsSettings as loadComboSettingsFromStorage,
  saveCombinedOddsSettings as saveComboSettingsToStorage,
} from "./combo-settings";
import { CLUB_PROFILES_KEY, recomputeClubProfiles } from "./club-profiles";
import { recomputeLearnerStats, emptyLearnerStats } from "./ai-learner";
import {
  recomputeTeamCharacteristics,
  emptyTeamCharacteristicsStore,
  TEAM_CHARACTERISTICS_KEY,
} from "./team-characteristics";
import { recomputeAnalysis } from "./analysis";
import { generateRecommendedBatch } from "./generate-recommended-batch";
import { generateTieredRecommendationBatches } from "./generate-tiered-recommendations";
import { generateLearnerRecommendedBatch } from "./learner-recommendations";
import { attachCorrectScoreToBatch } from "./correct-score-freeze";
import { loadClubRecordsForBatch } from "./club-record-insights";
import type { ClubIndex, ClubRecord } from "./club-record-types";
import type { TeamsQualityStore } from "./teams-quality-types";
import { normalizeStore, setRosterQualityStore } from "./teams-quality";
import { computeLeagueBaselines } from "./league-baselines";
import {
  emptyLeagueProfilesStore,
  recomputeLeagueProfiles,
} from "./league-profiles";
import type { MlClassifierStore } from "./ml-model-store";
import type { LeagueBaselinesStore } from "./league-baselines";

const BATCHES_KEY = "pl_prediction_batches";
const ANALYSIS_KEY = "pl_analysis_history";
const SETTINGS_KEY = "pl_recommendation_settings";
const LEARNER_STATS_KEY = "pl_ai_learner_stats";
const LEARNER_ENABLED_KEY = "pl_ai_learner_enabled";
const MIGRATED_KEY = "pl_kv_migrated";
const TEAMS_QUALITY_KEY = "pl_teams_quality";
export const LEAGUE_PROFILES_KEY = "pl_league_profiles";

let batchesCache: PredictionBatch[] = [];
let clubIndexCache: ClubIndex | null = null;
let teamsQualityCache: TeamsQualityStore | null = null;
let mlClassifierCache: MlClassifierStore | null = null;
let leagueBaselinesCache: LeagueBaselinesStore | null = null;
let storageInitPromise: Promise<void> | null = null;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function loadBatchesFromLocal(): PredictionBatch[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(BATCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { batches?: PredictionBatch[] };
    return Array.isArray(parsed.batches) ? parsed.batches : [];
  } catch {
    return [];
  }
}

export async function migrateLocalStorageToKv(): Promise<boolean> {
  if (!isBrowser()) return false;
  if (localStorage.getItem(MIGRATED_KEY) === "true") return false;
  const local = loadBatchesFromLocal();
  if (!local.length) {
    localStorage.setItem(MIGRATED_KEY, "true");
    return false;
  }
  const res = await fetch("/api/migrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batches: local }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Migration failed");
  if (!data.skipped) {
    localStorage.removeItem(BATCHES_KEY);
    localStorage.removeItem(CLUB_PROFILES_KEY);
    localStorage.removeItem(TEAM_CHARACTERISTICS_KEY);
  }
  localStorage.setItem(MIGRATED_KEY, "true");
  return true;
}

export async function initStorage(): Promise<void> {
  if (!isBrowser()) return;
  await migrateLocalStorageToKv();
  const res = await fetch("/api/batches");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to load batches");
  batchesCache = data.batches ?? [];
  const idxRes = await fetch("/api/clubs");
  const idxData = await idxRes.json();
  if (idxRes.ok) clubIndexCache = idxData.index ?? null;
  try {
    await fetchTeamsQuality();
  } catch {
    /* teams quality is optional at startup */
  }
  try {
    await fetchMlClassifier();
  } catch {
    /* ml model optional at startup */
  }
  leagueBaselinesCache = computeLeagueBaselines(batchesCache);
}

export function ensureStorageInit(): Promise<void> {
  if (!isBrowser()) return Promise.resolve();
  if (!storageInitPromise) {
    storageInitPromise = initStorage().catch((e) => {
      storageInitPromise = null;
      throw e;
    });
  }
  return storageInitPromise;
}

export function loadBatches(): PredictionBatch[] {
  return batchesCache;
}

export async function fetchBatches(): Promise<PredictionBatch[]> {
  await ensureStorageInit();
  return batchesCache;
}

export async function reloadBatchesFromServer(): Promise<PredictionBatch[]> {
  const res = await fetch("/api/batches");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to load batches");
  batchesCache = data.batches ?? [];
  return batchesCache;
}

export async function upsertBatch(batch: PredictionBatch): Promise<PredictionBatch[]> {
  const res = await fetch("/api/batches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to save batch");
  const saved = data.batch as PredictionBatch;
  const idx = batchesCache.findIndex((b) => b.id === saved.id);
  if (idx >= 0) batchesCache[idx] = saved;
  else batchesCache.unshift(saved);
  return batchesCache;
}

export function saveBatches(batches: PredictionBatch[]): void {
  batchesCache = batches;
}

export async function deleteBatch(batchId: string): Promise<void> {
  const res = await fetch(`/api/batches/${encodeURIComponent(batchId)}`, {
    method: "DELETE",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to delete batch");
  batchesCache = batchesCache.filter((b) => b.id !== batchId);
  if (isBrowser()) {
    saveAnalysis(recomputeAnalysis(batchesCache));
    updateClubProfiles();
    updateLearnerStats();
    updateTeamCharacteristics();
    updateLeagueProfiles();
  }
}

export async function resetAllBatches(): Promise<void> {
  const res = await fetch("/api/batches", { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error ?? "Failed to reset batches");
  }
  batchesCache = [];
  storageInitPromise = null;
  if (isBrowser()) {
    localStorage.removeItem(ANALYSIS_KEY);
    localStorage.removeItem(LEARNER_STATS_KEY);
    localStorage.removeItem(CLUB_PROFILES_KEY);
    localStorage.removeItem(TEAM_CHARACTERISTICS_KEY);
    localStorage.removeItem(LEAGUE_PROFILES_KEY);
  }
}

export function loadAnalysis(): AnalysisHistory | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(ANALYSIS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AnalysisHistory;
  } catch {
    return null;
  }
}

export function saveAnalysis(analysis: AnalysisHistory): void {
  if (!isBrowser()) return;
  localStorage.setItem(ANALYSIS_KEY, JSON.stringify(analysis));
}

export function loadRecommendationSettings(): RecommendationSettings {
  if (!isBrowser()) return defaultRecommendationSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultRecommendationSettings();
    const parsed = JSON.parse(raw) as RecommendationSettings;
    const defaults = defaultRecommendationSettings();
    const bs = parsed.bankrollStrategy;
    const dbs = defaults.bankrollStrategy;
    return {
      oddsFilteringEnabled: parsed.oddsFilteringEnabled !== false,
      tier1MinPFinal:
        typeof parsed.tier1MinPFinal === "number" ? parsed.tier1MinPFinal : defaults.tier1MinPFinal,
      tier3MaxBatchRisk:
        typeof parsed.tier3MaxBatchRisk === "number"
          ? parsed.tier3MaxBatchRisk
          : defaults.tier3MaxBatchRisk,
      tier3AllowAlternativeMarkets:
        parsed.tier3AllowAlternativeMarkets !== false,
      betterAlternativeThresholdPct:
        typeof parsed.betterAlternativeThresholdPct === "number"
          ? parsed.betterAlternativeThresholdPct
          : defaults.betterAlternativeThresholdPct,
      bankrollStrategy: {
        bankroll:
          bs?.bankroll != null && Number.isFinite(bs.bankroll) && bs.bankroll > 0
            ? bs.bankroll
            : null,
        startingBankroll:
          bs?.startingBankroll != null &&
          Number.isFinite(bs.startingBankroll) &&
          bs.startingBankroll > 0
            ? bs.startingBankroll
            : bs?.bankroll != null && Number.isFinite(bs.bankroll) && bs.bankroll > 0
              ? bs.bankroll
              : null,
        funBankroll:
          bs?.funBankroll != null && Number.isFinite(bs.funBankroll) && bs.funBankroll > 0
            ? bs.funBankroll
            : null,
        maxRiskPctPerBet: clampNum(bs?.maxRiskPctPerBet, 1, 2, dbs.maxRiskPctPerBet),
        riskProfile:
          bs?.riskProfile === "moderate" || bs?.riskProfile === "aggressive"
            ? bs.riskProfile
            : "conservative",
        stakingMode:
          bs?.stakingMode === "half_kelly" || bs?.stakingMode === "quarter_kelly"
            ? bs.stakingMode
            : "flat",
        flatStakePct: clampNum(bs?.flatStakePct, 0.1, 2, dbs.flatStakePct),
        tierStakeMult: {
          safe: clampNum(bs?.tierStakeMult?.safe, 0.1, 3, dbs.tierStakeMult.safe),
          balanced: clampNum(bs?.tierStakeMult?.balanced, 0.1, 3, dbs.tierStakeMult.balanced),
          aggressive: clampNum(
            bs?.tierStakeMult?.aggressive,
            0.1,
            3,
            dbs.tierStakeMult.aggressive
          ),
        },
        stopLossConsecutiveLosses: clampNum(
          bs?.stopLossConsecutiveLosses,
          1,
          20,
          dbs.stopLossConsecutiveLosses
        ),
        stopLossDailyDrawdownPct: clampNum(
          bs?.stopLossDailyDrawdownPct,
          1,
          50,
          dbs.stopLossDailyDrawdownPct
        ),
        stopLossRollingDays: clampNum(
          bs?.stopLossRollingDays,
          7,
          90,
          dbs.stopLossRollingDays
        ),
        stopLossRollingDrawdownPct: clampNum(
          bs?.stopLossRollingDrawdownPct,
          5,
          50,
          dbs.stopLossRollingDrawdownPct
        ),
        strategyAlertsEnabled: bs?.strategyAlertsEnabled !== false,
      },
    };
  } catch {
    return defaultRecommendationSettings();
  }
}

function clampNum(
  v: number | undefined,
  min: number,
  max: number,
  fallback: number
): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

export function saveRecommendationSettings(settings: RecommendationSettings): void {
  if (!isBrowser()) return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadCombinedOddsSettings(): CombinedOddsSettings {
  return loadComboSettingsFromStorage();
}

export function saveCombinedOddsSettings(settings: CombinedOddsSettings): void {
  saveComboSettingsToStorage(settings);
}

export function loadClubProfiles(): ClubProfilesStore {
  if (!isBrowser()) return emptyClubProfilesStore();
  try {
    const raw = localStorage.getItem(CLUB_PROFILES_KEY);
    if (!raw) return recomputeClubProfiles(batchesCache);
    const parsed = JSON.parse(raw) as ClubProfilesStore;
    return parsed?.profiles ? parsed : recomputeClubProfiles(batchesCache);
  } catch {
    return recomputeClubProfiles(batchesCache);
  }
}

export function saveClubProfiles(store: ClubProfilesStore): void {
  if (!isBrowser()) return;
  localStorage.setItem(CLUB_PROFILES_KEY, JSON.stringify(store));
}

export function emptyClubProfilesStore(): ClubProfilesStore {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(), profiles: {} };
}

export function updateClubProfiles(_batchId?: string): ClubProfilesStore {
  const store = recomputeClubProfiles(batchesCache);
  saveClubProfiles(store);
  return store;
}

export function loadTeamCharacteristics(): TeamCharacteristicsStore {
  if (!isBrowser()) return emptyTeamCharacteristicsStore();
  try {
    const raw = localStorage.getItem(TEAM_CHARACTERISTICS_KEY);
    if (!raw) return recomputeTeamCharacteristics(batchesCache, emptyTeamCharacteristicsStore());
    const parsed = JSON.parse(raw) as TeamCharacteristicsStore;
    return parsed?.teams
      ? parsed
      : recomputeTeamCharacteristics(batchesCache, emptyTeamCharacteristicsStore());
  } catch {
    return recomputeTeamCharacteristics(batchesCache, emptyTeamCharacteristicsStore());
  }
}

export function saveTeamCharacteristics(store: TeamCharacteristicsStore): void {
  if (!isBrowser()) return;
  localStorage.setItem(TEAM_CHARACTERISTICS_KEY, JSON.stringify(store));
}

export function updateTeamCharacteristics(): TeamCharacteristicsStore {
  const existing = loadTeamCharacteristics();
  const store = recomputeTeamCharacteristics(batchesCache, existing);
  saveTeamCharacteristics(store);
  return store;
}

export function loadLeagueProfiles(): LeagueProfilesStore {
  if (!isBrowser()) return recomputeLeagueProfiles(batchesCache, emptyLeagueProfilesStore());
  try {
    const raw = localStorage.getItem(LEAGUE_PROFILES_KEY);
    if (!raw) return recomputeLeagueProfiles(batchesCache, emptyLeagueProfilesStore());
    const parsed = JSON.parse(raw) as LeagueProfilesStore;
    return parsed?.leagues
      ? parsed
      : recomputeLeagueProfiles(batchesCache, emptyLeagueProfilesStore());
  } catch {
    return recomputeLeagueProfiles(batchesCache, emptyLeagueProfilesStore());
  }
}

export function saveLeagueProfiles(store: LeagueProfilesStore): void {
  if (!isBrowser()) return;
  localStorage.setItem(LEAGUE_PROFILES_KEY, JSON.stringify(store));
}

export function updateLeagueProfiles(): LeagueProfilesStore {
  const existing = loadLeagueProfiles();
  const store = recomputeLeagueProfiles(batchesCache, existing);
  saveLeagueProfiles(store);
  return store;
}

export function loadLearnerStats(): LearnerStatsStore {
  if (!isBrowser()) return emptyLearnerStats();
  try {
    const raw = localStorage.getItem(LEARNER_STATS_KEY);
    if (!raw) return emptyLearnerStats();
    const parsed = JSON.parse(raw) as LearnerStatsStore;
    return parsed?.oddsRanges ? parsed : emptyLearnerStats();
  } catch {
    return emptyLearnerStats();
  }
}

export function saveLearnerStats(stats: LearnerStatsStore): void {
  if (!isBrowser()) return;
  localStorage.setItem(LEARNER_STATS_KEY, JSON.stringify(stats));
}

export function updateLearnerStats(): LearnerStatsStore {
  const analysis = recomputeAnalysis(batchesCache);
  const clubProfiles = loadClubProfiles();
  const stats = recomputeLearnerStats(batchesCache, analysis, clubProfiles);
  saveLearnerStats(stats);
  return stats;
}

export function loadLearnerEnabled(): boolean {
  if (!isBrowser()) return false;
  try {
    return localStorage.getItem(LEARNER_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveLearnerEnabled(enabled: boolean): void {
  if (!isBrowser()) return;
  localStorage.setItem(LEARNER_ENABLED_KEY, enabled ? "true" : "false");
}

export function loadLuckyNumbers(): LuckyNumbersStore {
  if (!isBrowser()) return emptyLuckyNumbersStore();
  try {
    const raw = localStorage.getItem(LUCKY_NUMBERS_KEY);
    if (!raw) return emptyLuckyNumbersStore();
    const parsed = JSON.parse(raw) as LuckyNumbersStore;
    return Array.isArray(parsed.numbers) ? parsed : emptyLuckyNumbersStore();
  } catch {
    return emptyLuckyNumbersStore();
  }
}

export function saveLuckyNumbers(numbers: number[]): LuckyNumbersStore {
  const store: LuckyNumbersStore = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    numbers,
  };
  if (isBrowser()) {
    localStorage.setItem(LUCKY_NUMBERS_KEY, JSON.stringify(store));
  }
  return store;
}

export function getClubIndexCache(): ClubIndex | null {
  return clubIndexCache;
}

export async function fetchClubRecord(clubId: string): Promise<ClubRecord | null> {
  const res = await fetch(`/api/clubs/${encodeURIComponent(clubId)}`);
  const data = await res.json();
  if (!res.ok) return null;
  return data.club as ClubRecord;
}

export async function refreshClubIndex(): Promise<ClubIndex | null> {
  const res = await fetch("/api/clubs");
  const data = await res.json();
  if (!res.ok) return null;
  clubIndexCache = data.index;
  return clubIndexCache;
}

export function getTeamsQualityCache(): TeamsQualityStore | null {
  return teamsQualityCache;
}

export async function fetchTeamsQuality(): Promise<TeamsQualityStore> {
  const res = await fetch("/api/teams-quality");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to load teams quality");
  teamsQualityCache = normalizeStore(data.store);
  setRosterQualityStore(teamsQualityCache);
  if (isBrowser()) {
    localStorage.setItem(TEAMS_QUALITY_KEY, JSON.stringify(teamsQualityCache));
  }
  return teamsQualityCache;
}

export async function saveTeamsQuality(store: TeamsQualityStore): Promise<TeamsQualityStore> {
  const res = await fetch("/api/teams-quality", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ store }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to save teams quality");
  teamsQualityCache = normalizeStore(data.store);
  setRosterQualityStore(teamsQualityCache);
  if (isBrowser()) {
    localStorage.setItem(TEAMS_QUALITY_KEY, JSON.stringify(teamsQualityCache));
  }
  return teamsQualityCache;
}

export async function addTeamQuality(
  teamName: string,
  tier: TeamsQualityStore["teams"][number]["tier"],
  league?: string
): Promise<TeamsQualityStore> {
  const res = await fetch("/api/teams-quality", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "add", team_name: teamName, tier, league }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to add team");
  teamsQualityCache = normalizeStore(data.store);
  setRosterQualityStore(teamsQualityCache);
  if (isBrowser()) {
    localStorage.setItem(TEAMS_QUALITY_KEY, JSON.stringify(teamsQualityCache));
  }
  return teamsQualityCache;
}

export async function importTeamsQuality(
  text: string,
  mode: "merge" | "replace" = "merge"
): Promise<TeamsQualityStore> {
  const res = await fetch("/api/teams-quality", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "import", text, mode }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to import teams");
  teamsQualityCache = normalizeStore(data.store);
  setRosterQualityStore(teamsQualityCache);
  if (isBrowser()) {
    localStorage.setItem(TEAMS_QUALITY_KEY, JSON.stringify(teamsQualityCache));
  }
  return teamsQualityCache;
}

export async function fetchMlClassifier(): Promise<MlClassifierStore | null> {
  const res = await fetch("/api/ml-model");
  const data = await res.json();
  if (!res.ok) return null;
  mlClassifierCache = data.classifier ?? null;
  leagueBaselinesCache = data.leagueBaselines ?? computeLeagueBaselines(batchesCache);
  return mlClassifierCache;
}

export async function retrainMlModel(): Promise<{
  trainingRows: number;
  algorithm: string;
  sampleCount: number;
}> {
  const res = await fetch("/api/ml-model/retrain", { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Retrain failed");
  await fetchMlClassifier();
  leagueBaselinesCache = computeLeagueBaselines(batchesCache);
  return {
    trainingRows: data.trainingRows,
    algorithm: data.algorithm,
    sampleCount: data.sampleCount,
  };
}

export function getStatEngineExtras() {
  return {
    leagueBaselines: leagueBaselinesCache ?? computeLeagueBaselines(batchesCache),
    mlClassifier: mlClassifierCache,
    teamsQuality: teamsQualityCache,
    leagueProfiles: loadLeagueProfiles(),
  };
}

export async function loadClubRecordsForBatchFromCache(
  batch: PredictionBatch
): Promise<Record<string, ClubRecord>> {
  await ensureStorageInit();
  return loadClubRecordsForBatch(batch, clubIndexCache, fetchClubRecord);
}

export function generateBatchRecommendation(
  batch: PredictionBatch,
  settings: RecommendationSettings,
  learnerEnabled?: boolean,
  clubRecords: Record<string, ClubRecord> | null = null,
  clubIndex: ClubIndex | null = null,
  luckyNumbers: number[] = []
): PredictionBatch {
  const all = batchesCache;
  const analysis = recomputeAnalysis(all);
  const clubProfiles = loadClubProfiles();
  const teamCharacteristics = loadTeamCharacteristics();
  const useLearner = learnerEnabled ?? loadLearnerEnabled();
  const learnerStats = loadLearnerStats();
  const index = clubIndex ?? clubIndexCache;

  const recommended = useLearner
    ? generateLearnerRecommendedBatch(
        batch,
        all,
        analysis,
        settings,
        clubProfiles,
        learnerStats,
        teamCharacteristics,
        clubRecords,
        index,
        luckyNumbers
      )
    : generateRecommendedBatch(
        batch,
        all,
        analysis,
        settings,
        clubProfiles,
        clubRecords,
        index,
        luckyNumbers,
        getStatEngineExtras()
      );

  return recommended ? attachCorrectScoreToBatch({ ...batch, recommended }) : batch;
}

export async function generateBatchRecommendationAsync(
  batch: PredictionBatch,
  settings: RecommendationSettings,
  learnerEnabled?: boolean,
  luckyNumbers: number[] = []
): Promise<PredictionBatch> {
  const clubRecords = await loadClubRecordsForBatchFromCache(batch);
  return generateBatchRecommendation(batch, settings, learnerEnabled, clubRecords, null, luckyNumbers);
}

export async function generateTieredRecommendationBatchesAsync(
  batch: PredictionBatch,
  settings: RecommendationSettings,
  learnerEnabled = false,
  luckyNumbers: number[] = []
): Promise<PredictionBatch[]> {
  const clubRecords = await loadClubRecordsForBatchFromCache(batch);
  const all = batchesCache;
  const analysis = recomputeAnalysis(all);
  const clubProfiles = loadClubProfiles();
  const learnerStats = loadLearnerStats();
  const teamCharacteristics = loadTeamCharacteristics();
  const index = clubIndexCache;
  if (!teamsQualityCache) {
    try {
      await fetchTeamsQuality();
    } catch {
      /* proceed without tier data */
    }
  }

  return generateTieredRecommendationBatches(
    batch,
    all,
    analysis,
    settings,
    learnerEnabled,
    learnerStats,
    teamCharacteristics,
    clubProfiles,
    clubRecords,
    index,
    luckyNumbers,
    teamsQualityCache,
    {
      leagueBaselines: getStatEngineExtras().leagueBaselines,
      mlClassifier: getStatEngineExtras().mlClassifier,
      leagueProfiles: getStatEngineExtras().leagueProfiles,
    }
  ).tiers;
}

export async function refreshBatchLearnerRecommendation(
  batchId: string,
  settings: RecommendationSettings
): Promise<PredictionBatch | null> {
  const batch = batchesCache.find((b) => b.id === batchId);
  if (!batch) return null;
  const updated = await generateBatchRecommendationAsync(batch, settings, true);
  await upsertBatch(updated);
  return updated;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
