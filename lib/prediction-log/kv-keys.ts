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
  /** Cached API-Football fixture list: league|all:season:YYYY-MM-DD */
  apiFootballFixtures: (key: string) => `apiFootball:fixtures:v1:${key}`,
  /** Cached API-Football fixture statistics by fixture id. */
  apiFootballStats: (fixtureId: number | string) =>
    `apiFootball:stats:v1:${fixtureId}`,
  /** Bulk last-5 scrape progress (failed leagues for retry). */
  livescoreBulkProgress: "livescore:bulk:v1:progress",
  /** Saved reco walk-forward backtest run ids (newest first). */
  backtestRunsIndex: "backtestRuns:v1:index",
  backtestRun: (runId: string) => `backtestRun:v1:${runId}`,
  /** Telegram external user by Telegram chat/user id. */
  telegramUser: (telegramId: string) => `telegram:user:v1:${telegramId}`,
  telegramUsersIndex: "telegram:users:v1:index",
  /** Batch ids owned by an internal user id. */
  telegramUserBatches: (userId: string) => `telegram:userBatches:v1:${userId}`,
  /** Conversation session for guided Create Batch. */
  telegramSession: (telegramId: string) => `telegram:session:v1:${telegramId}`,
  /** Daily rate-limit counter. */
  telegramRateLimit: (telegramId: string, day: string) =>
    `telegram:rl:v1:${telegramId}:${day}`,
  /** Dedup Telegram webhook retries by update_id. */
  telegramUpdateClaim: (updateId: number) => `telegram:upd:v1:${updateId}`,
  /** Global AI Learner stats (web + telegram scored batches). */
  learnerStats: "learnerStats:v1",
} as const;
