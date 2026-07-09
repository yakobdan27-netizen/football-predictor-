import type { OddsBandId } from "./types";

export const ODDS_BAND_IDS: OddsBandId[] = [
  "1.00-1.50",
  "1.51-2.00",
  "2.01-2.50",
  "2.51-3.00",
];

export const ODDS_BAND_LABELS: Record<OddsBandId, string> = {
  "1.00-1.50": "1.00 – 1.50",
  "1.51-2.00": "1.51 – 2.00",
  "2.01-2.50": "2.01 – 2.50",
  "2.51-3.00": "2.51 – 3.00",
};

/** Boundary values belong to the lower band (e.g. 2.00 → 1.51–2.00). */
export function oddsToBand(odds: number): OddsBandId {
  if (odds <= 1.5) return "1.00-1.50";
  if (odds <= 2.0) return "1.51-2.00";
  if (odds <= 2.5) return "2.01-2.50";
  return "2.51-3.00";
}

export function isValidOdds(n: number | undefined | null): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 3;
}

export function impliedProbability(odds: number): number {
  if (!isValidOdds(odds)) return 0;
  return 1 / odds;
}

export function resultExportLabel(
  result: "correct" | "wrong" | "push" | null | undefined
): string {
  if (result === "correct") return "Win";
  if (result === "wrong") return "Loss";
  if (result === "push") return "Push";
  return "";
}
