import {
  AGREEMENT_BONUS_MAX,
  COLLABORATION_WEIGHT_EMS,
  COLLABORATION_WEIGHT_MSAM,
  CONFLICT_PENALTY_MAX,
} from "./config";
import type {
  AgreementStatus,
  EmsSnapshot,
  MsamCandidate,
  ScoredMsamCandidate,
} from "./types";

function percentileRank(value: number, values: number[]): number {
  if (values.length === 0) return 50;
  const sorted = [...values].sort((a, b) => a - b);
  const below = sorted.filter((v) => v <= value).length;
  return (below / sorted.length) * 100;
}

function emsScoreForCode(ems: EmsSnapshot, marketCode: string): number | null {
  const hit = ems.candidates.find((c) => c.marketCode === marketCode);
  return hit ? hit.emsScore : null;
}

export function applyCollaboration(input: {
  candidates: MsamCandidate[];
  emsSnapshot: EmsSnapshot;
  primary: MsamCandidate[];
}): {
  scored: ScoredMsamCandidate[];
  normalizationBootstrap: boolean;
} {
  const { candidates, emsSnapshot, primary } = input;
  const msamScores = candidates.map((c) => c.msamScore);
  const emsScores = emsSnapshot.candidates.map((c) => c.emsScore);
  const primaryCodes = new Set(primary.map((p) => p.marketCode));
  const emsPrimaryCodes = new Set(
    emsSnapshot.candidates.filter((c) => c.existingRank <= 3).map((c) => c.marketCode)
  );

  const scored: ScoredMsamCandidate[] = candidates.map((c) => {
    const qMsam = percentileRank(c.msamScore, msamScores);
    const rawEms = emsScoreForCode(emsSnapshot, c.marketCode);
    const qEms =
      rawEms != null ? percentileRank(rawEms, emsScores.length ? emsScores : [rawEms]) : null;

    let agreementStatus: AgreementStatus = "Insufficient Data";
    let agreementBonus = 0;
    let conflictPenalty = 0;

    if (qEms != null) {
      const inEmsTop = emsPrimaryCodes.has(c.marketCode);
      const inMsamTop = primaryCodes.has(c.marketCode);
      if (inEmsTop && inMsamTop) {
        agreementStatus = "Strong Agreement";
        agreementBonus = Math.min(AGREEMENT_BONUS_MAX, 3 + (qEms + qMsam) / 40);
      } else if (inMsamTop && !inEmsTop) {
        agreementStatus = "MSAM Lead";
      } else if (inEmsTop && !inMsamTop) {
        agreementStatus = "Existing Method Lead";
      } else if (Math.abs(qEms - qMsam) > 35) {
        agreementStatus = "Conflict / Review";
        conflictPenalty = Math.min(CONFLICT_PENALTY_MAX, Math.abs(qEms - qMsam) / 15);
      } else {
        agreementStatus = "Conflict / Review";
      }
    }

    const finalAdvisory =
      qEms != null
        ? Math.max(
            0,
            Math.min(
              100,
              COLLABORATION_WEIGHT_EMS * qEms +
                COLLABORATION_WEIGHT_MSAM * qMsam +
                agreementBonus -
                conflictPenalty
            )
          )
        : null;

    return {
      ...c,
      msamNormalizedScore: qMsam,
      existingNormalizedScore: qEms,
      finalAdvisoryScore: finalAdvisory,
      agreementStatus,
      selectionRole: "rejected",
      primaryRank: null,
    };
  });

  return { scored, normalizationBootstrap: true };
}

export function advisoryTier(
  c: ScoredMsamCandidate
): "Strong" | "Usable" | "Caution" | "Insufficient Data" {
  if (!c.eligible) return "Insufficient Data";
  if (c.agreementStatus === "Strong Agreement" && (c.finalAdvisoryScore ?? 0) >= 70) {
    return "Strong";
  }
  if ((c.finalAdvisoryScore ?? c.msamScore) >= 55) return "Usable";
  if ((c.finalAdvisoryScore ?? c.msamScore) >= 40) return "Caution";
  return "Insufficient Data";
}
