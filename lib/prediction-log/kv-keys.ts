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
  /** Cached Livescore scrape payload (event id or date|home|away). */
  livescoreCache: (key: string) => `livescore:v1:${key}`,
  /** Bulk last-5 scrape progress (failed leagues for retry). */
  livescoreBulkProgress: "livescore:bulk:v1:progress",
} as const;
