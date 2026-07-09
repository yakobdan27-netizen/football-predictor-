export const KV_KEYS = {
  clubIndex: "clubIndex",
  batchIndex: "batchIndex",
  clubIdCounter: "clubIdCounter",
  teamsQuality: "teamsQuality",
  leagueBaselines: "leagueBaselines",
  mlClassifier: "mlClassifier",
  bayesianCalibrationLog: "bayesianCalibrationLog",
  club: (clubId: string) => `club:${clubId}`,
  batch: (batchId: string) => `batch:${batchId}`,
  matchup: (clubIdA: string, clubIdB: string) => {
    const [a, b] = [clubIdA, clubIdB].sort();
    return `matchup:${a}_${b}`;
  },
} as const;
