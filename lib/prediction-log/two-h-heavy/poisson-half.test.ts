/**
 * Run: npx tsx lib/prediction-log/two-h-heavy/poisson-half.test.ts
 */
import assert from "node:assert/strict";
import {
  computeConfidence,
  computeHalfMus,
  isThinData,
  poissonHalfProbs,
} from "./poisson-half";
import { conditionOnRealized1h } from "./live-condition";
import { compareTwoHHeavy } from "./rank";
import type { TeamHalfProfile, TwoHHeavyResult } from "./types";
import { BETA_2H, MIN_MATCHES } from "./config";

function profile(
  partial: Partial<TeamHalfProfile> & Pick<TeamHalfProfile, "sc_1h" | "sc_2h" | "conc_1h" | "conc_2h">
): TeamHalfProfile {
  return {
    team: partial.team ?? "T",
    venue: partial.venue ?? "home",
    sc_1h: partial.sc_1h,
    sc_2h: partial.sc_2h,
    conc_1h: partial.conc_1h,
    conc_2h: partial.conc_2h,
    n_matches: partial.n_matches ?? 10,
    last_match_date: partial.last_match_date ?? "2026-07-01",
    source: partial.source ?? "db",
  };
}

function resultFromProfiles(
  id: string,
  home: TeamHalfProfile,
  away: TeamHalfProfile,
  league = "Premier League"
): TwoHHeavyResult {
  const mus = computeHalfMus(home, away, league);
  const probs = poissonHalfProbs(mus.mu_1h_final, mus.mu_2h_final);
  const confidence = computeConfidence(
    probs.p_2h_gt_1h,
    home.n_matches,
    away.n_matches,
    home.last_match_date,
    away.last_match_date
  );
  return {
    matchId: id,
    homeTeam: home.team,
    awayTeam: away.team,
    league,
    ...probs,
    confidence,
    data_source: home.source === "prior" || away.source === "prior" ? "prior" : "db",
    thinData: isThinData(home.n_matches, away.n_matches),
    partlyFromApi: home.source === "api" || away.source === "api",
    insufficientData: isThinData(home.n_matches, away.n_matches),
    homeProfile: home,
    awayProfile: away,
    live: false,
  };
}

// --- Formula: strong 2H teams → higher P(2H>1H) than front-loaded ---
{
  const lateHome = profile({
    team: "Late H",
    sc_1h: 0.3,
    sc_2h: 1.2,
    conc_1h: 0.3,
    conc_2h: 1.0,
    n_matches: 12,
  });
  const lateAway = profile({
    team: "Late A",
    venue: "away",
    sc_1h: 0.25,
    sc_2h: 1.1,
    conc_1h: 0.35,
    conc_2h: 0.95,
    n_matches: 12,
  });
  const earlyHome = profile({
    team: "Early H",
    sc_1h: 1.2,
    sc_2h: 0.3,
    conc_1h: 1.0,
    conc_2h: 0.3,
    n_matches: 12,
  });
  const earlyAway = profile({
    team: "Early A",
    venue: "away",
    sc_1h: 1.1,
    sc_2h: 0.25,
    conc_1h: 0.95,
    conc_2h: 0.35,
    n_matches: 12,
  });

  const late = resultFromProfiles("late", lateHome, lateAway);
  const early = resultFromProfiles("early", earlyHome, earlyAway);
  assert.ok(
    late.p_2h_gt_1h > early.p_2h_gt_1h,
    `late ${late.p_2h_gt_1h} should beat early ${early.p_2h_gt_1h}`
  );
  assert.ok(compareTwoHHeavy(late, early) < 0);
}

// --- Equal p → confidence tiebreak (more matches wins) ---
{
  const rich = resultFromProfiles(
    "rich",
    profile({ sc_1h: 0.6, sc_2h: 0.8, conc_1h: 0.5, conc_2h: 0.7, n_matches: 20 }),
    profile({
      venue: "away",
      sc_1h: 0.55,
      sc_2h: 0.75,
      conc_1h: 0.55,
      conc_2h: 0.75,
      n_matches: 20,
    })
  );
  const thin = {
    ...rich,
    matchId: "thin",
    confidence: computeConfidence(
      rich.p_2h_gt_1h,
      3,
      3,
      "2026-07-01",
      "2026-07-01"
    ),
    thinData: true,
    homeProfile: { ...rich.homeProfile, n_matches: 3 },
    awayProfile: { ...rich.awayProfile, n_matches: 3 },
  };
  assert.equal(rich.p_2h_gt_1h, thin.p_2h_gt_1h);
  assert.ok(rich.confidence > thin.confidence);
  assert.ok(compareTwoHHeavy(rich, thin) < 0);
  assert.ok(isThinData(3, 10));
  assert.ok(!isThinData(MIN_MATCHES, MIN_MATCHES));
}

// --- Probabilities sum ≈ 1 ---
{
  const mus = computeHalfMus(
    profile({ sc_1h: 0.7, sc_2h: 0.9, conc_1h: 0.6, conc_2h: 0.8 }),
    profile({ venue: "away", sc_1h: 0.65, sc_2h: 0.85, conc_1h: 0.55, conc_2h: 0.75 }),
    "Premier League"
  );
  const probs = poissonHalfProbs(mus.mu_1h_final, mus.mu_2h_final);
  const sum = probs.p_2h_gt_1h + probs.p_2h_eq_1h + probs.p_2h_lt_1h;
  // Truncation at POISSON_CAP=10 leaves tiny missing mass for large μ.
  assert.ok(Math.abs(sum - 1) < 1e-4, `sum=${sum}`);
}

// --- raw_total === 0 → 45/55 prior split ---
{
  const zero = profile({ sc_1h: 0, sc_2h: 0, conc_1h: 0, conc_2h: 0 });
  const mus = computeHalfMus(zero, zero, "Premier League");
  assert.ok(mus.usedPriorSplit);
  assert.ok(Math.abs(mus.mu_1h_final - 2.85 * 0.45) < 1e-9);
  assert.ok(Math.abs(mus.mu_2h_final - 2.85 * 0.55) < 1e-9);
}

// --- BETA tilt applied before scale ---
{
  const home = profile({ sc_1h: 1, sc_2h: 1, conc_1h: 1, conc_2h: 1 });
  const away = { ...home, venue: "away" as const };
  const mus = computeHalfMus(home, away, "Premier League");
  // mu_1h = 2, mu_2h = 2, tilted = 2 * 1.15 = 2.3, raw = 4.3
  assert.ok(Math.abs(mus.mu_1h - 2) < 1e-9);
  assert.ok(Math.abs(mus.mu_2h_tilted - 2 * BETA_2H) < 1e-9);
  assert.ok(mus.mu_2h_final > mus.mu_1h_final);
}

// --- Live conditioning ---
{
  const live = conditionOnRealized1h({
    realized_1h: 2,
    goals_2h_so_far: 0,
    mu_2h_final: 1.5,
  });
  const sum = live.p_2h_gt_1h + live.p_2h_eq_1h + live.p_2h_lt_1h;
  assert.ok(Math.abs(sum - 1) < 1e-4, `live sum=${sum}`);
  assert.ok(live.p_2h_gt_1h < 0.5); // need 3+ goals from Poisson(1.5)
}

console.log("two-h-heavy poisson-half tests passed");
