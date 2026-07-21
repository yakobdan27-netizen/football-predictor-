import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveBatchDateFromMatches, todayIsoDate } from "./batch-date";

test("deriveBatchDateFromMatches picks earliest matchDate", () => {
  assert.equal(
    deriveBatchDateFromMatches([
      { matchDate: "2026-08-20" },
      { matchDate: "2026-08-15" },
      { matchDate: "2026-08-22" },
    ]),
    "2026-08-15"
  );
});

test("deriveBatchDateFromMatches falls back to today when empty", () => {
  assert.equal(deriveBatchDateFromMatches([]), todayIsoDate());
  assert.equal(deriveBatchDateFromMatches([{ matchDate: undefined }]), todayIsoDate());
});

test("deriveBatchDateFromMatches uses fallback string", () => {
  assert.equal(deriveBatchDateFromMatches([], "2026-09-01"), "2026-09-01");
});
