import type { LuckyNumbersStore } from "./types";

export const LUCKY_NUMBERS_KEY = "pl_lucky_numbers";

export function emptyLuckyNumbersStore(): LuckyNumbersStore {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    numbers: [],
  };
}

/** Parse comma/space-separated lucky numbers (1–99). */
export function parseLuckyNumbersInput(raw: string): number[] {
  const nums = raw
    .split(/[,\s]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 99);
  return [...new Set(nums)].sort((a, b) => a - b);
}

/** Check if odds decimal part matches a lucky number (e.g. 2.07 → 7, 1.23 → 23). */
export function oddsMatchesLuckyNumber(odds: number, lucky: number[]): boolean {
  if (!lucky.length || !Number.isFinite(odds)) return false;
  const cents = Math.round((odds % 1) * 100);
  if (lucky.includes(cents)) return true;
  const tenths = Math.round((odds % 1) * 10);
  if (lucky.includes(tenths)) return true;
  return false;
}

export function luckyInfluenceNote(odds: number, lucky: number[]): string | null {
  if (!oddsMatchesLuckyNumber(odds, lucky)) return null;
  const cents = Math.round((odds % 1) * 100);
  const tenths = Math.round((odds % 1) * 10);
  const matched = lucky.find((n) => n === cents || n === tenths);
  return matched != null
    ? `Lucky number ${matched} aligns with odds ${odds.toFixed(2)}`
    : null;
}

export function formatLuckyNumbers(nums: number[]): string {
  return nums.length ? nums.join(", ") : "None set";
}
