import { STAT_ENGINE_CONFIG, ML_GRADIENT_BOOSTING_MIN_N } from "./stat-engine-config";
import type { MlAlgorithm } from "./stat-engine-config";
import {
  FEATURE_NAMES,
  type OutcomeLabel,
  type TrainingFeatureRow,
} from "./training-data";
import type {
  GradientBoostingModel,
  LogisticModel,
  MlClassifierModel,
  MlClassifierStore,
  MlOutcomeProbs,
  NaiveBayesModel,
  RandomForestModel,
} from "./ml-model-store";
import { emptyMlClassifierStore } from "./ml-model-store";

const LABELS: OutcomeLabel[] = ["home", "draw", "away"];
const LABEL_IDX: Record<OutcomeLabel, number> = { home: 0, draw: 1, away: 2 };

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => (sum > 0 ? e / sum : 1 / logits.length));
}

function trainLogistic(rows: TrainingFeatureRow[]): LogisticModel {
  const nFeatures = rows[0]?.features.length ?? FEATURE_NAMES.length;
  const weights = Array.from({ length: 3 }, () => Array(nFeatures).fill(0));
  const biases = [0, 0, 0];
  const lr = 0.05;
  const epochs = 80;

  for (let epoch = 0; epoch < epochs; epoch++) {
    for (const row of rows) {
      const logits = biases.map((b, c) =>
        b + row.features.reduce((s, f, i) => s + f * weights[c]![i]!, 0)
      );
      const probs = softmax(logits);
      const y = LABEL_IDX[row.label];
      for (let c = 0; c < 3; c++) {
        const err = probs[c]! - (c === y ? 1 : 0);
        biases[c]! -= lr * err;
        for (let i = 0; i < nFeatures; i++) {
          weights[c]![i]! -= lr * err * row.features[i]!;
        }
      }
    }
  }

  return { type: "logistic", weights, biases, featureCount: nFeatures };
}

function trainNaiveBayes(rows: TrainingFeatureRow[]): NaiveBayesModel {
  const nFeatures = rows[0]?.features.length ?? FEATURE_NAMES.length;
  const means = Array.from({ length: 3 }, () => Array(nFeatures).fill(0));
  const variances = Array.from({ length: 3 }, () => Array(nFeatures).fill(1));
  const classPriors = [0, 0, 0];

  for (const label of LABELS) {
    const idx = LABEL_IDX[label];
    const subset = rows.filter((r) => r.label === label);
    classPriors[idx] = subset.length / rows.length;
    if (!subset.length) continue;
    for (let f = 0; f < nFeatures; f++) {
      const vals = subset.map((r) => r.features[f]!);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      means[idx]![f] = mean;
      const variance =
        vals.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(vals.length, 1);
      variances[idx]![f] = Math.max(variance, 0.01);
    }
  }

  return { type: "naive_bayes", means, variances, classPriors };
}

function trainRandomForest(rows: TrainingFeatureRow[]): RandomForestModel {
  const trees: RandomForestModel["trees"] = [];
  const nTrees = 15;
  for (let t = 0; t < nTrees; t++) {
    const sample = rows[Math.floor(Math.random() * rows.length)]!;
    const fIdx = Math.floor(Math.random() * sample.features.length);
    const threshold = sample.features[fIdx]!;
    const leftRows = rows.filter((r) => r.features[fIdx]! <= threshold);
    const rightRows = rows.filter((r) => r.features[fIdx]! > threshold);
    const majority = (subset: TrainingFeatureRow[]) => {
      const counts = [0, 0, 0];
      for (const r of subset) counts[LABEL_IDX[r.label]]!++;
      return counts.indexOf(Math.max(...counts));
    };
    trees.push({
      featureIdx: fIdx,
      threshold,
      leftClass: majority(leftRows.length ? leftRows : rows),
      rightClass: majority(rightRows.length ? rightRows : rows),
    });
  }
  return { type: "random_forest", trees };
}

/**
 * Softmax gradient boosting with one-level trees (stumps).
 * Same role as XGBoost/LightGBM multiclass in a pure-TS runtime (no native deps).
 */
function trainGradientBoosting(rows: TrainingFeatureRow[]): GradientBoostingModel {
  const nFeatures = rows[0]?.features.length ?? FEATURE_NAMES.length;
  const nRounds = 40;
  const learningRate = 0.1;
  const stages: GradientBoostingModel["stages"] = [[], [], []];

  const F = rows.map(() => [0, 0, 0] as number[]);

  for (let round = 0; round < nRounds; round++) {
    const residuals = rows.map((row, i) => {
      const probs = softmax(F[i]!);
      const y = LABEL_IDX[row.label];
      return probs.map((p, c) => (c === y ? 1 : 0) - p);
    });

    for (let c = 0; c < 3; c++) {
      let best = {
        featureIdx: 0,
        threshold: 0,
        leftValue: 0,
        rightValue: 0,
        score: Number.POSITIVE_INFINITY,
      };

      const tryCount = Math.min(24, nFeatures * 3);
      for (let t = 0; t < tryCount; t++) {
        const fIdx = Math.floor(Math.random() * nFeatures);
        const sample = rows[Math.floor(Math.random() * rows.length)]!;
        const threshold = sample.features[fIdx]!;

        let leftSum = 0;
        let leftN = 0;
        let rightSum = 0;
        let rightN = 0;
        for (let i = 0; i < rows.length; i++) {
          const r = residuals[i]![c]!;
          if (rows[i]!.features[fIdx]! <= threshold) {
            leftSum += r;
            leftN += 1;
          } else {
            rightSum += r;
            rightN += 1;
          }
        }
        if (leftN === 0 || rightN === 0) continue;
        const leftValue = leftSum / leftN;
        const rightValue = rightSum / rightN;
        let sse = 0;
        for (let i = 0; i < rows.length; i++) {
          const pred =
            rows[i]!.features[fIdx]! <= threshold ? leftValue : rightValue;
          const err = residuals[i]![c]! - pred;
          sse += err * err;
        }
        if (sse < best.score) {
          best = { featureIdx: fIdx, threshold, leftValue, rightValue, score: sse };
        }
      }

      stages[c]!.push({
        featureIdx: best.featureIdx,
        threshold: best.threshold,
        leftValue: best.leftValue,
        rightValue: best.rightValue,
      });

      for (let i = 0; i < rows.length; i++) {
        const stump = stages[c]![stages[c]!.length - 1]!;
        const delta =
          rows[i]!.features[stump.featureIdx]! <= stump.threshold
            ? stump.leftValue
            : stump.rightValue;
        F[i]![c]! += learningRate * delta;
      }
    }
  }

  return { type: "gradient_boosting", stages, learningRate, featureCount: nFeatures };
}

export function selectAlgorithm(sampleCount: number): MlAlgorithm {
  if (sampleCount >= ML_GRADIENT_BOOSTING_MIN_N) return "gradient_boosting";
  if (sampleCount >= STAT_ENGINE_CONFIG.ML_RANDOMFOREST_MIN_N) return "random_forest";
  if (sampleCount >= STAT_ENGINE_CONFIG.ML_MIN_SAMPLES_LOGISTIC) return "logistic";
  return "naive_bayes";
}

export function trainClassifier(rows: TrainingFeatureRow[]): MlClassifierStore {
  if (rows.length < STAT_ENGINE_CONFIG.ML_MIN_SAMPLES_NAIVE) {
    return emptyMlClassifierStore();
  }

  const algorithm = selectAlgorithm(rows.length);
  let model: MlClassifierModel;
  if (algorithm === "gradient_boosting") model = trainGradientBoosting(rows);
  else if (algorithm === "random_forest") model = trainRandomForest(rows);
  else if (algorithm === "logistic") model = trainLogistic(rows);
  else model = trainNaiveBayes(rows);

  return {
    model,
    algorithm,
    sampleCount: rows.length,
    trainedAt: new Date().toISOString(),
    version: 1,
  };
}

function predictLogistic(model: LogisticModel, features: number[]): MlOutcomeProbs {
  const logits = model.biases.map((b, c) =>
    b + features.reduce((s, f, i) => s + f * model.weights[c]![i]!, 0)
  );
  const [home, draw, away] = softmax(logits);
  return { home, draw, away };
}

function gaussianPdf(x: number, mean: number, variance: number): number {
  return (
    Math.exp(-0.5 * ((x - mean) ** 2) / variance) / Math.sqrt(2 * Math.PI * variance)
  );
}

function predictNaiveBayes(model: NaiveBayesModel, features: number[]): MlOutcomeProbs {
  const logProbs = model.classPriors.map((prior, c) => {
    let lp = Math.log(Math.max(prior, 1e-9));
    for (let i = 0; i < features.length; i++) {
      lp += Math.log(
        Math.max(
          gaussianPdf(features[i]!, model.means[c]![i]!, model.variances[c]![i]!),
          1e-9
        )
      );
    }
    return lp;
  });
  const probs = softmax(logProbs);
  return { home: probs[0]!, draw: probs[1]!, away: probs[2]! };
}

function predictRandomForest(model: RandomForestModel, features: number[]): MlOutcomeProbs {
  const votes = [0, 0, 0];
  for (const tree of model.trees) {
    const cls =
      features[tree.featureIdx]! <= tree.threshold ? tree.leftClass : tree.rightClass;
    votes[cls]!++;
  }
  const total = votes.reduce((a, b) => a + b, 0);
  return {
    home: votes[0]! / total,
    draw: votes[1]! / total,
    away: votes[2]! / total,
  };
}

function predictGradientBoosting(
  model: GradientBoostingModel,
  features: number[]
): MlOutcomeProbs {
  const logits = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    for (const stump of model.stages[c] ?? []) {
      const delta =
        features[stump.featureIdx]! <= stump.threshold
          ? stump.leftValue
          : stump.rightValue;
      logits[c]! += model.learningRate * delta;
    }
  }
  const [home, draw, away] = softmax(logits);
  return { home, draw, away };
}

export function predictMlOutcome(
  store: MlClassifierStore | null,
  features: number[]
): MlOutcomeProbs {
  if (!store?.model) {
    return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  }
  if (store.model.type === "logistic") return predictLogistic(store.model, features);
  if (store.model.type === "naive_bayes") return predictNaiveBayes(store.model, features);
  if (store.model.type === "gradient_boosting") {
    return predictGradientBoosting(store.model, features);
  }
  return predictRandomForest(store.model, features);
}

export function mlProbForPick(probs: MlOutcomeProbs, prediction: string): number {
  const p = prediction.toLowerCase().trim();
  if (p === "home" || p === "1" || p === "h") return probs.home;
  if (p === "away" || p === "2" || p === "a") return probs.away;
  if (p === "draw" || p === "x") return probs.draw;
  return Math.max(probs.home, probs.draw, probs.away);
}

export function mlProbToPercent(prob: number): number {
  return Math.round(Math.max(0, Math.min(100, prob * 100)));
}
