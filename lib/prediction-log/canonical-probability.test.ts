import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  canonicalProbability,
  canonicalProbabilityFromHsh,
  computeCanonicalHshPrediction,
  hshPredictionToLadderResult,
} from "./canonical-probability";
import { predictHighestScoringHalf } from "./hsh-model";
import type { ClubHalfAttackDefence } from "./hsh-half-rates";
import { emptyHalfTempoProfile } from "./half-tempo";

function rates(
  partial: Partial<ClubHalfAttackDefence> & { clubName: string }
): ClubHalfAttackDefence {
  return {
    clubName: partial.clubName,
    league: partial.league ?? "Premier League",
    af1: partial.af1 ?? 0.7,
    af2: partial.af2 ?? 0.9,
    da1: partial.da1 ?? 0.55,
    da2: partial.da2 ?? 0.7,
    nMatches: partial.nMatches ?? 40,
    seasonCount: partial.seasonCount ?? 4,
    seedOnly: partial.seedOnly ?? false,
    sourceNote: partial.sourceNote ?? null,
  };
}

const sampleCtx = {
  matchId: "m-city-bournemouth",
  homeTeam: "Manchester City",
  awayTeam: "Bournemouth",
  league: "Premier League",
  homeRates: rates({ clubName: "Manchester City", af1: 0.85, af2: 1.05, da1: 0.4, da2: 0.5 }),
  awayRates: rates({ clubName: "Bournemouth", af1: 0.55, af2: 0.75, da1: 0.7, da2: 0.85 }),
  lgAf1: 0.62,
  lgAf2: 0.78,
  homeTempo: emptyHalfTempoProfile(),
  awayTempo: emptyHalfTempoProfile(),
};

test("canonical half probs match predictHighestScoringHalf Stage B", () => {
  const direct = predictHighestScoringHalf(sampleCtx);
  const viaCanon = computeCanonicalHshPrediction(sampleCtx);
  assert.equal(viaCanon.p1h, direct.p1h);
  assert.equal(viaCanon.p2h, direct.p2h);
  assert.equal(viaCanon.pTie, direct.pTie);
  assert.equal(viaCanon.lambda1h, direct.lambda1h);
  assert.equal(viaCanon.lambda2h, direct.lambda2h);

  const c2h = canonicalProbability({ market: "hsh_2h_gt_1h", ctx: sampleCtx });
  assert.equal(c2h.prob, direct.p2h);
  assert.ok(c2h.prob >= 0 && c2h.prob <= 1);
  assert.ok(c2h.sourceBreakdown);
  assert.ok(c2h.computedAt);
  assert.equal(c2h.lambdaH, direct.lambda1h);
  assert.equal(c2h.lambdaA, direct.lambda2h);
  assert.ok(c2h.sampleSize != null);
});

test("cross-surface identity: ladder leg p equals HSH p2h", () => {
  const hsh = computeCanonicalHshPrediction(sampleCtx);
  const ladder = hshPredictionToLadderResult(hsh);
  assert.equal(ladder.p_2h_gt_1h, hsh.p2h);
  assert.equal(ladder.p_2h_eq_1h, hsh.pTie);
  assert.equal(ladder.p_2h_lt_1h, hsh.p1h);
  assert.equal(ladder.expected_1h, hsh.lambda1h);
  assert.equal(ladder.expected_2h, hsh.lambda2h);

  const fromHshMarket = canonicalProbabilityFromHsh(hsh, "hsh_2h");
  assert.equal(fromHshMarket.prob, ladder.p_2h_gt_1h);
});

test("complement: hsh_1h + hsh_2h + hsh_tie ≈ 1", () => {
  const p1 = canonicalProbability({ market: "hsh_1h", ctx: sampleCtx });
  const p2 = canonicalProbability({ market: "hsh_2h", ctx: sampleCtx });
  const pt = canonicalProbability({ market: "hsh_tie", ctx: sampleCtx });
  assert.ok(Math.abs(p1.prob + p2.prob + pt.prob - 1) < 1e-9);
});

test("ft_event routes through 60/40 metadata", () => {
  const r = canonicalProbability({
    market: "ft_event",
    apiProb: 0.7,
    manualAiProb: 0.5,
    scale: "unit",
    fixtureKey: "ft-test",
  });
  assert.ok(Math.abs(r.prob - (0.6 * 0.7 + 0.4 * 0.5)) < 1e-9);
  assert.equal(r.sourceBreakdown, "blended");
  assert.equal(r.apiWeight, 0.6);
  assert.equal(r.manualAiWeight, 0.4);
});

test("ladder ranking hook source does not import computeHalfMus", () => {
  const file = path.join(
    process.cwd(),
    "components/prediction-log/use-two-h-heavy-ranking.ts"
  );
  const src = readFileSync(file, "utf8");
  assert.equal(/from\s+["'][^"']*two-h-heavy\/poisson-half/.test(src), false);
  assert.equal(/import\s*\{[^}]*computeHalfMus/.test(src), false);
  assert.equal(/import\s*\{[^}]*predictTwoHHeavy/.test(src), false);
  assert.equal(/import\s*\{[^}]*predictBatchTwoHHeavy/.test(src), false);
  assert.ok(src.includes("computeCanonicalHshPrediction"));
  assert.ok(src.includes("hshPredictionToLadderResult"));
});

test("named fixtures share identical canonical p2h across surfaces", () => {
  const fixtures = [
    {
      matchId: "m1",
      homeTeam: "Manchester City",
      awayTeam: "Bournemouth",
      homeRates: rates({ clubName: "Manchester City", af1: 0.85, af2: 1.05 }),
      awayRates: rates({ clubName: "Bournemouth", af1: 0.55, af2: 0.75 }),
    },
    {
      matchId: "m2",
      homeTeam: "Fulham",
      awayTeam: "Chelsea",
      homeRates: rates({ clubName: "Fulham", af1: 0.6, af2: 0.8 }),
      awayRates: rates({ clubName: "Chelsea", af1: 0.75, af2: 0.95 }),
    },
    {
      matchId: "m3",
      homeTeam: "Newcastle",
      awayTeam: "Liverpool",
      homeRates: rates({ clubName: "Newcastle", af1: 0.7, af2: 0.95 }),
      awayRates: rates({ clubName: "Liverpool", af1: 0.9, af2: 1.1 }),
    },
    {
      matchId: "m4",
      homeTeam: "Brentford",
      awayTeam: "Tottenham",
      homeRates: rates({ clubName: "Brentford", af1: 0.65, af2: 0.85 }),
      awayRates: rates({ clubName: "Tottenham", af1: 0.72, af2: 0.98 }),
    },
  ];

  for (const f of fixtures) {
    const ctx = {
      ...sampleCtx,
      matchId: f.matchId,
      homeTeam: f.homeTeam,
      awayTeam: f.awayTeam,
      homeRates: f.homeRates,
      awayRates: f.awayRates,
    };
    const hsh = computeCanonicalHshPrediction(ctx);
    const ladder = hshPredictionToLadderResult(hsh);
    const canon = canonicalProbability({ market: "hsh_2h_gt_1h", ctx });
    assert.equal(
      ladder.p_2h_gt_1h,
      canon.prob,
      `${f.homeTeam} vs ${f.awayTeam} ladder≠canon`
    );
    assert.equal(hsh.p2h, canon.prob, `${f.homeTeam} vs ${f.awayTeam} hsh≠canon`);
  }
});
