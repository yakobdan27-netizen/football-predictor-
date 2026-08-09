/**
 * Grep-based guard: half-share / κ must not be hardcoded outside fitters + tests.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.join(process.cwd(), "lib");

/** Patterns that look like fabricated half-share / κ constants in model code. */
const FORBIDDEN = [
  /halfShare\s*[:=]\s*0\.\d+/,
  /s1\s*[:=]\s*0\.\d{2,}/,
  /kappa\s*[:=]\s*1\.\d+/,
  /HALF_SHARE\s*=\s*0\./,
  /KAPPA\s*=\s*1\./,
];

const ALLOW_PATH_FRAGMENTS = [
  "fit-half-params",
  "half-params",
  "half-params-types",
  "dieh-probability.test",
  "no-hardcoded-half-params",
  "dieh-calibration",
  "total-goals-markets.test",
  "fit-model-params",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

test("no hardcoded half-share or kappa literals in model source", () => {
  const files = walk(ROOT);
  const offenders: string[] = [];
  for (const file of files) {
    if (ALLOW_PATH_FRAGMENTS.some((f) => file.includes(f))) continue;
    const text = readFileSync(file, "utf8");
    for (const re of FORBIDDEN) {
      if (re.test(text)) {
        offenders.push(`${path.relative(process.cwd(), file)} ~ ${re}`);
      }
    }
  }
  assert.equal(
    offenders.length,
    0,
    `Hardcoded half-share/κ suspects:\n${offenders.join("\n")}`
  );
});
