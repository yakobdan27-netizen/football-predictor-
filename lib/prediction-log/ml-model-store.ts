import { getJson, setJson } from "./kv";
import { KV_KEYS } from "./kv-keys";
import type { MlAlgorithm } from "./stat-engine-config";

export interface MlOutcomeProbs {
  home: number;
  draw: number;
  away: number;
}

export interface LogisticModel {
  type: "logistic";
  weights: number[][];
  biases: number[];
  featureCount: number;
}

export interface NaiveBayesModel {
  type: "naive_bayes";
  means: number[][];
  variances: number[][];
  classPriors: number[];
}

export interface RandomForestModel {
  type: "random_forest";
  trees: Array<{ featureIdx: number; threshold: number; leftClass: number; rightClass: number }>;
}

export type MlClassifierModel = LogisticModel | NaiveBayesModel | RandomForestModel;

export interface MlClassifierStore {
  model: MlClassifierModel | null;
  algorithm: MlAlgorithm;
  sampleCount: number;
  trainedAt: string;
  version: number;
}

export function emptyMlClassifierStore(): MlClassifierStore {
  return {
    model: null,
    algorithm: "naive_bayes",
    sampleCount: 0,
    trainedAt: "",
    version: 1,
  };
}

export async function loadMlClassifier(): Promise<MlClassifierStore> {
  const stored = await getJson<MlClassifierStore>(KV_KEYS.mlClassifier);
  return stored ?? emptyMlClassifierStore();
}

export async function saveMlClassifier(store: MlClassifierStore): Promise<void> {
  await setJson(KV_KEYS.mlClassifier, store);
}

export async function loadLeagueBaselinesFromKv() {
  const { getJson: g } = await import("./kv");
  const { KV_KEYS: keys } = await import("./kv-keys");
  return g(keys.leagueBaselines);
}

export async function saveLeagueBaselinesToKv(store: unknown): Promise<void> {
  await setJson(KV_KEYS.leagueBaselines, store);
}
