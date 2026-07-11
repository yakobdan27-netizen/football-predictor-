import { KV_KEYS } from "./kv-keys";
import { getJson, setJson } from "./kv";
import type { RecoBacktestConfig, RecoBacktestResult, RecoBacktestSummary } from "./backtest-engine";

const MAX_SAVED_RUNS = 20;

export interface RecoBacktestRunMeta {
  id: string;
  createdAt: string;
  config: RecoBacktestConfig;
  nMatches: number;
  summary: RecoBacktestSummary;
}

export interface RecoBacktestRunsIndex {
  schemaVersion: 1;
  updatedAt: string;
  runs: RecoBacktestRunMeta[];
}

function emptyIndex(): RecoBacktestRunsIndex {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    runs: [],
  };
}

export async function loadBacktestRunsIndex(): Promise<RecoBacktestRunsIndex> {
  return (await getJson<RecoBacktestRunsIndex>(KV_KEYS.backtestRunsIndex)) ?? emptyIndex();
}

export async function saveBacktestRun(
  result: RecoBacktestResult
): Promise<RecoBacktestRunMeta> {
  await setJson(KV_KEYS.backtestRun(result.id), result);
  const index = await loadBacktestRunsIndex();
  const meta: RecoBacktestRunMeta = {
    id: result.id,
    createdAt: result.createdAt,
    config: result.config,
    nMatches: result.summary.nMatches,
    summary: result.summary,
  };
  const runs = [meta, ...index.runs.filter((r) => r.id !== meta.id)].slice(
    0,
    MAX_SAVED_RUNS
  );
  await setJson(KV_KEYS.backtestRunsIndex, {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    runs,
  } satisfies RecoBacktestRunsIndex);
  return meta;
}

export async function loadBacktestRun(
  runId: string
): Promise<RecoBacktestResult | null> {
  return getJson<RecoBacktestResult>(KV_KEYS.backtestRun(runId));
}

export async function listBacktestRuns(): Promise<RecoBacktestRunMeta[]> {
  const index = await loadBacktestRunsIndex();
  return index.runs;
}
