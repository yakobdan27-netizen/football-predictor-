import assert from "node:assert/strict";
import { BAYESIAN_CONFIG } from "./bayesian-config";
import {
  createGammaPrior,
  createBetaPrior,
  updateGamma,
  updateBeta,
  decayGamma,
  initBayesianMarkets,
  gammaMean,
  betaMean,
} from "./bayesian-update";
import { computeBayesianMatchPrediction } from "./bayesian-predict";
import { shrinkPStat } from "./stat-probability";
import { createClubRecord } from "./club-record-types";
import { passesBayesianIntervalGate } from "./bayesian-tier";

// Gamma update increases mean after goals
const prior = createGammaPrior("C");
const priorMean = gammaMean(prior);
const updated = updateGamma(prior, 3);
const afterOne = updateGamma(updated, 2);
assert.ok(gammaMean(afterOne) > priorMean);

// Beta update: 2 wins in 4 observations
const betaPrior = createBetaPrior("C");
const b1 = updateBeta(betaPrior, true);
const b2 = updateBeta(b1, true);
const b3 = updateBeta(b2, false);
const b4 = updateBeta(b3, false);
const expected = (betaPrior.posterior.alpha + 2) / (betaPrior.posterior.alpha + betaPrior.posterior.beta + 4);
assert.ok(Math.abs(betaMean(b4) - expected) < 0.01);

// Decay shrinks pseudo-counts toward prior
const g = updateGamma(createGammaPrior(null), 5);
const decayed = decayGamma(g, 0.5);
assert.ok(Math.abs(decayed.posterior.shape - g.prior.shape) < Math.abs(g.posterior.shape - g.prior.shape));

// Tier A gets higher gamma prior shape than tier D
const tierA = createGammaPrior("A");
const tierD = createGammaPrior("D");
assert.ok(tierA.prior.shape > tierD.prior.shape);

// MC prediction returns valid interval
const home = createClubRecord("h1", "Alpha", "Premier League");
home.bayesianMarkets = initBayesianMarkets("A");
const away = createClubRecord("a1", "Beta", "Premier League");
away.bayesianMarkets = initBayesianMarkets("D");

const result = computeBayesianMatchPrediction(
  home,
  away,
  "Premier League",
  null,
  null,
  "1x2",
  "home",
  undefined,
  200
);
const est = result.marketEstimates["1x2"];
assert.ok(est);
assert.ok(est.point >= 0 && est.point <= 1);
assert.ok(est.lo <= est.point && est.point <= est.hi);
assert.ok(est.hi - est.lo >= 0);

const gridTotal = result.scoreGridMean.reduce(
  (s, row) => s + row.reduce((a, b) => a + b, 0),
  0
);
assert.ok(Math.abs(gridTotal - 1) < 0.05);

// Parallel mode: shrink unchanged when BAYESIAN_FEEDS_SIGNAL is false
assert.equal(BAYESIAN_CONFIG.BAYESIAN_FEEDS_SIGNAL, false);
assert.equal(shrinkPStat(80, 0), 50);
assert.equal(shrinkPStat(80, 8), 80);
assert.equal(passesBayesianIntervalGate("safe", 0.5), true);

console.log("bayesian-engine.test.ts: all passed");
