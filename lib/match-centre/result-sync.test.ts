import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  mapToLiveFixture,
  type MatchCentreFixtureInput,
} from "./register-fixtures";

const ROOT = resolve(process.cwd(), "lib");

test("mapToLiveFixture maps upcoming row to live fixture", () => {
  const row: MatchCentreFixtureInput = {
    apiFixtureId: 12345,
    kickoffIso: "2026-08-16T14:00:00Z",
    matchDate: "2026-08-16",
    status: "NS",
    home: { id: 1, name: "Barcelona" },
    away: { id: 2, name: "Real Madrid" },
    venue: "Camp Nou",
    leagueId: 140,
    league: "La Liga",
  };
  const syncedAt = new Date("2026-08-16T12:00:00Z");
  const fx = mapToLiveFixture(row, syncedAt);
  assert.equal(fx.fixtureId, 12345);
  assert.equal(fx.leagueId, 140);
  assert.equal(fx.homeTeam, "Barcelona");
  assert.equal(fx.awayTeam, "Real Madrid");
  assert.equal(fx.status, "NS");
  assert.equal(fx.homeGoals, null);
  assert.equal(fx.venue, "Camp Nou");
  assert.equal(fx.season, 2026);
});

test("match-centre modules do not import prediction-log writers", () => {
  const files = [
    "match-centre/register-fixtures.ts",
    "match-centre/recent-results.ts",
  ];
  const importLine = /^\s*import\s+.+\s+from\s+["']([^"']+)["']/gm;
  for (const f of files) {
    const text = readFileSync(resolve(ROOT, f), "utf8");
    const imports = [...text.matchAll(importLine)].map((m) => m[1] ?? "");
    for (const src of imports) {
      assert.doesNotMatch(
        src,
        /prediction-log|trace-fixture-by-pair|sync-prediction-log/,
        `${f} import from ${src}`
      );
    }
  }
});

test("result-sync may import live-fixtures bridge only", () => {
  const text = readFileSync(
    resolve(ROOT, "match-centre/result-sync.ts"),
    "utf8"
  );
  const importLine = /^\s*import\s+.+\s+from\s+["']([^"']+)["']/gm;
  const imports = [...text.matchAll(importLine)].map((m) => m[1] ?? "");
  const plImports = imports.filter((s) => s.includes("prediction-log"));
  assert.deepEqual(plImports, ["@/lib/prediction-log/sync-from-live-fixtures"]);
});

test("result-sync imports live and bets only (not sync-results)", () => {
  const text = readFileSync(
    resolve(ROOT, "match-centre/result-sync.ts"),
    "utf8"
  );
  const importLine = /^\s*import\s+.+\s+from\s+["']([^"']+)["']/gm;
  const imports = [...text.matchAll(importLine)].map((m) => m[1] ?? "");
  assert.ok(imports.some((s) => s.includes("lib/live")));
  assert.ok(imports.some((s) => s.includes("lib/bets")));
  for (const src of imports) {
    assert.doesNotMatch(src, /sync-results|fill-telegram-results|trace-fixture/);
  }
});
