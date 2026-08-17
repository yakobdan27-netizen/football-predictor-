import assert from "node:assert/strict";
import { test } from "node:test";
import {
  API_SEASON_BLEND,
  blendApiSeasonRates,
  hasEnoughCurrentSeasonData,
  isInCurrentApiSeasonWindow,
} from "./api-season-blend";

test("isInCurrentApiSeasonWindow covers Aug 2026 – Jul 2027", () => {
  assert.equal(isInCurrentApiSeasonWindow("2026-07-31"), false);
  assert.equal(isInCurrentApiSeasonWindow("2026-08-01"), true);
  assert.equal(isInCurrentApiSeasonWindow("2027-07-31"), true);
  assert.equal(isInCurrentApiSeasonWindow("2027-08-01"), false);
});

test("hasEnoughCurrentSeasonData threshold is 6", () => {
  assert.equal(hasEnoughCurrentSeasonData(5), false);
  assert.equal(hasEnoughCurrentSeasonData(6), true);
  assert.equal(hasEnoughCurrentSeasonData(10), true);
});

test("blendApiSeasonRates uses 60/40 when n >= 6", () => {
  const prior = { af1: 1.0, af2: 1.2, da1: 0.8, da2: 0.9 };
  const current = { af1: 2.0, af2: 2.4, da1: 1.6, da2: 1.8 };
  const r = blendApiSeasonRates(prior, current, 6);
  assert.equal(r.mode, "60_40");
  assert.equal(r.nCurrent, 6);
  const wP = API_SEASON_BLEND.prior;
  const wC = API_SEASON_BLEND.current;
  assert.equal(r.af1, wP * 1.0 + wC * 2.0);
  assert.equal(r.af2, wP * 1.2 + wC * 2.4);
  assert.equal(r.da1, wP * 0.8 + wC * 1.6);
  assert.equal(r.da2, wP * 0.9 + wC * 1.8);
});

test("blendApiSeasonRates falls back to 100% prior when n < 6", () => {
  const prior = { af1: 1.0, af2: 1.2, da1: 0.8, da2: 0.9 };
  const current = { af1: 2.0, af2: 2.4, da1: 1.6, da2: 1.8 };
  const r = blendApiSeasonRates(prior, current, 5);
  assert.equal(r.mode, "prior_only");
  assert.equal(r.af1, prior.af1);
  assert.equal(r.af2, prior.af2);
  assert.equal(r.da1, prior.da1);
  assert.equal(r.da2, prior.da2);
});

test("blendApiSeasonRates falls back when current missing", () => {
  const prior = { af1: 0.5, af2: 0.6, da1: 0.7, da2: 0.8 };
  const r = blendApiSeasonRates(prior, null, 0);
  assert.equal(r.mode, "prior_only");
  assert.deepEqual(
    { af1: r.af1, af2: r.af2, da1: r.da1, da2: r.da2 },
    prior
  );
});
