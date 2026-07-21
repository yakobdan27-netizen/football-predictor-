"use client";

import { useCallback, useEffect, useState } from "react";
import { recomputeAnalysis } from "@/lib/prediction-log/analysis";
import {
  ensureStorageInit,
  loadBatches,
  loadClubProfiles,
  loadLearnerEnabled,
  loadLearnerStats,
  loadLuckyNumbers,
  loadRecommendationSettings,
  loadCombinedOddsSettings,
  loadTeamCharacteristics,
  loadLeagueProfiles,
  refreshClubIndex,
  saveLearnerEnabled,
  saveRecommendationSettings,
  saveCombinedOddsSettings,
  updateLeagueProfiles,
  fetchTeamsQuality,
  fetchMlClassifier,
  getTeamsQualityCache,
  getStatEngineExtras,
  hydrateLearnerStatsFromServer,
  hydrateLeaguePriorsFromServer,
} from "@/lib/prediction-log/storage";
import type {
  AnalysisHistory,
  ClubProfilesStore,
  LearnerStatsStore,
  LuckyNumbersStore,
  PredictionBatch,
  RecommendationSettings,
  CombinedOddsSettings,
  TeamCharacteristicsStore,
  LeagueProfilesStore,
} from "@/lib/prediction-log/types";
import type { LeaguePriorsStore } from "@/lib/prediction-log/league-priors";
import type { ClubIndex } from "@/lib/prediction-log/club-record-types";
import type { MlClassifierStore } from "@/lib/prediction-log/ml-model-store";
import type { TeamsQualityStore } from "@/lib/prediction-log/teams-quality-types";

export function usePredictionLogData() {
  const [batches, setBatches] = useState<PredictionBatch[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisHistory | null>(null);
  const [learnerStats, setLearnerStats] = useState<LearnerStatsStore | null>(null);
  const [teamCharacteristics, setTeamCharacteristics] = useState<TeamCharacteristicsStore | null>(null);
  const [leagueProfiles, setLeagueProfiles] = useState<LeagueProfilesStore | null>(null);
  const [leaguePriors, setLeaguePriors] = useState<LeaguePriorsStore | null>(null);
  const [clubProfiles, setClubProfiles] = useState<ClubProfilesStore | null>(null);
  const [clubIndex, setClubIndex] = useState<ClubIndex | null>(null);
  const [luckyNumbers, setLuckyNumbers] = useState<LuckyNumbersStore | null>(null);
  const [recoSettings, setRecoSettings] = useState<RecommendationSettings>(() =>
    loadRecommendationSettings()
  );
  const [comboSettings, setComboSettings] = useState<CombinedOddsSettings>(() =>
    loadCombinedOddsSettings()
  );
  const [learnerEnabled, setLearnerEnabled] = useState(false);
  const [teamsQuality, setTeamsQuality] = useState<TeamsQualityStore | null>(null);
  const [mlClassifier, setMlClassifier] = useState<MlClassifierStore | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      await ensureStorageInit();
      const b = loadBatches();
      const a = recomputeAnalysis(b);
      const idx = await refreshClubIndex();
      setBatches(b);
      setAnalysis(a);
      setLearnerStats(await hydrateLearnerStatsFromServer());
      setTeamCharacteristics(loadTeamCharacteristics());
      setLeagueProfiles(updateLeagueProfiles());
      setLeaguePriors(await hydrateLeaguePriorsFromServer());
      setClubProfiles(loadClubProfiles());
      setClubIndex(idx);
      setLuckyNumbers(loadLuckyNumbers());
      setLearnerEnabled(loadLearnerEnabled());
      setRecoSettings(loadRecommendationSettings());
      setComboSettings(loadCombinedOddsSettings());
      try {
        await fetchTeamsQuality();
        setTeamsQuality(getTeamsQualityCache());
      } catch {
        setTeamsQuality(null);
      }
      try {
        await fetchMlClassifier();
        setMlClassifier(getStatEngineExtras().mlClassifier);
      } catch {
        setMlClassifier(null);
      }
      setError(null);
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setSettings = useCallback((settings: RecommendationSettings) => {
    setRecoSettings(settings);
    saveRecommendationSettings(settings);
  }, []);

  const setComboOddsSettings = useCallback((settings: CombinedOddsSettings) => {
    setComboSettings(settings);
    saveCombinedOddsSettings(settings);
  }, []);

  const setLearner = useCallback((enabled: boolean) => {
    setLearnerEnabled(enabled);
    saveLearnerEnabled(enabled);
  }, []);

  return {
    ready,
    error,
    batches,
    analysis,
    learnerStats,
    teamCharacteristics,
    leagueProfiles,
    leaguePriors,
    clubProfiles,
    clubIndex,
    luckyNumbers,
    recoSettings,
    comboSettings,
    learnerEnabled,
    teamsQuality,
    mlClassifier,
    refresh,
    setSettings,
    setComboOddsSettings,
    setLearner,
  };
}
