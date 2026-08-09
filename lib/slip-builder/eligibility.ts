/**
 * Hard eligibility gates — failing legs are excluded, never down-weighted.
 */
import type { BinCalibrator } from "@/lib/predictor/calibration";
import { scoreLegFromCanonical } from "./canonical-leg";
import { applySlipCalibration } from "./slip-calibration";
import { enumerateFamilySelections } from "./families";
import type { PoolFixture } from "./batch-pool";
import { resolveWindow } from "./batch-pool";
import type {
  CandidateLeg,
  ExclusionReason,
  FilteredLeg,
  MarketFamilyId,
  SlipPreferences,
} from "./types";

const MIN_N_EFFECTIVE = 30;

function lambdasComplete(est: PoolFixture["estimate"]): boolean {
  const L = est.lambdas;
  const vals = [L.home, L.away, L.home_1h, L.away_1h, L.home_2h, L.away_2h];
  return vals.every((v) => Number.isFinite(v) && v > 0);
}

function familyDataOk(
  family: MarketFamilyId,
  est: PoolFixture["estimate"]
): boolean {
  if (!lambdasComplete(est)) return false;
  if (!est.diagnostics.halfSumOk && (family === "HALF_GOALS" || family === "DIEH" || family === "HT_RESULT")) {
    return false;
  }
  if (family === "DIEH" && est.markets.dieh.status !== "ok") return false;
  if (!est.score_matrix?.length) return false;
  return true;
}

export function buildCandidateLeg(input: {
  fixture: PoolFixture;
  family: MarketFamilyId;
  selectionKey: string;
  selectionLabel: string;
  line?: number | null;
  comboId?: string | null;
  calibrator: BinCalibrator | null;
}): CandidateLeg | null {
  const { fixture, family } = input;
  const scored = scoreLegFromCanonical({
    estimate: fixture.estimate,
    family,
    selectionKey: input.selectionKey,
    line: input.line,
    comboId: input.comboId,
    fixtureKey: fixture.fixtureId,
  });
  if (!scored.available) return null;
  const cal = applySlipCalibration(
    scored.pRaw,
    scored.nEffective,
    input.calibrator
  );
  return {
    fixtureId: fixture.fixtureId,
    apiFixtureId: fixture.apiFixtureId,
    matchId: fixture.matchId,
    sourceBatchId: fixture.sourceBatchId,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    competition: fixture.competition,
    kickoffIso: fixture.kickoffIso,
    kickoffMs: fixture.kickoffMs,
    family,
    selectionKey: input.selectionKey,
    selectionLabel: input.selectionLabel,
    line: input.line ?? null,
    comboId: input.comboId ?? null,
    pRaw: scored.pRaw,
    pCalibrated: cal.pCalibrated,
    nEffective: scored.nEffective,
    ciWidth: cal.ciWidth,
    calibrated: cal.calibrated,
    coherenceOk: scored.coherenceOk,
  };
}

export function gateLeg(
  leg: CandidateLeg,
  prefs: SlipPreferences,
  window: { start: string; end: string }
): ExclusionReason[] {
  const reasons: ExclusionReason[] = [];
  if (leg.pCalibrated < prefs.pMin) reasons.push("probability_floor");
  if (leg.nEffective < MIN_N_EFFECTIVE) reasons.push("sample_insufficiency");
  if (!leg.coherenceOk) reasons.push("coherence");
  const d = leg.kickoffIso.slice(0, 10);
  if (d < window.start || d > window.end) reasons.push("freshness");
  if (prefs.excludeUncalibrated && !leg.calibrated) {
    reasons.push("uncalibrated");
  }
  return reasons;
}

export function enumerateAndGateFamily(input: {
  fixtures: PoolFixture[];
  family: MarketFamilyId;
  prefs: SlipPreferences;
  calibrator: BinCalibrator | null;
}): { eligible: CandidateLeg[]; filtered: FilteredLeg[] } {
  const window = resolveWindow(input.prefs);
  const selections = enumerateFamilySelections(input.family);
  const eligible: CandidateLeg[] = [];
  const filtered: FilteredLeg[] = [];

  for (const fixture of input.fixtures) {
    if (!familyDataOk(input.family, fixture.estimate)) {
      for (const sel of selections) {
        filtered.push({
          fixtureId: fixture.fixtureId,
          apiFixtureId: fixture.apiFixtureId,
          matchId: fixture.matchId,
          sourceBatchId: fixture.sourceBatchId,
          homeTeam: fixture.homeTeam,
          awayTeam: fixture.awayTeam,
          competition: fixture.competition,
          kickoffIso: fixture.kickoffIso,
          kickoffMs: fixture.kickoffMs,
          family: input.family,
          selectionKey: sel.selectionKey,
          selectionLabel: sel.selectionLabel,
          line: sel.line ?? null,
          comboId: sel.comboId ?? null,
          pRaw: 0,
          pCalibrated: 0,
          nEffective: fixture.estimate.provenance.ess || 0,
          ciWidth: 0.5,
          calibrated: false,
          coherenceOk: false,
          reasons: ["data_incomplete", "family_unavailable"],
        });
      }
      continue;
    }

    for (const sel of selections) {
      const leg = buildCandidateLeg({
        fixture,
        family: input.family,
        selectionKey: sel.selectionKey,
        selectionLabel: sel.selectionLabel,
        line: sel.line,
        comboId: sel.comboId,
        calibrator: input.calibrator,
      });
      if (!leg) {
        filtered.push({
          fixtureId: fixture.fixtureId,
          apiFixtureId: fixture.apiFixtureId,
          matchId: fixture.matchId,
          sourceBatchId: fixture.sourceBatchId,
          homeTeam: fixture.homeTeam,
          awayTeam: fixture.awayTeam,
          competition: fixture.competition,
          kickoffIso: fixture.kickoffIso,
          kickoffMs: fixture.kickoffMs,
          family: input.family,
          selectionKey: sel.selectionKey,
          selectionLabel: sel.selectionLabel,
          line: sel.line ?? null,
          comboId: sel.comboId ?? null,
          pRaw: 0,
          pCalibrated: 0,
          nEffective: fixture.estimate.provenance.ess || 0,
          ciWidth: 0.5,
          calibrated: false,
          coherenceOk: false,
          reasons: ["family_unavailable"],
        });
        continue;
      }
      const reasons = gateLeg(leg, input.prefs, window);
      if (reasons.length > 0) {
        filtered.push({ ...leg, reasons });
      } else {
        eligible.push(leg);
      }
    }
  }

  return { eligible, filtered };
}
