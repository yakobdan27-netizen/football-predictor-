/**
 * Grep test #7: no odds/price/implied/stake/ev_ in slip-builder modules.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOTS = [
  path.join(process.cwd(), "lib", "slip-builder"),
  path.join(process.cwd(), "components", "slip-builder"),
  path.join(process.cwd(), "app", "slips"),
  path.join(process.cwd(), "app", "api", "slips"),
];

const FORBIDDEN = /\b(odds|price|implied|stake|ev_)\b/i;

function walk(dir: string, out: string[] = []): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.includes(".test.")) out.push(p);
  }
  return out;
}

test("slip-builder modules contain no odds/price/implied/stake/ev_", () => {
  const files = ROOTS.flatMap((r) => walk(r));
  assert.ok(files.length > 0, "expected slip-builder source files");
  const hits: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (FORBIDDEN.test(line)) {
        hits.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(hits, [], hits.join("\n"));
});
