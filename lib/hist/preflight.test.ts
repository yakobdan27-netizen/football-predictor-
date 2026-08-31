/**
 * Run: npx tsx lib/hist/preflight.test.ts
 */
import assert from "node:assert/strict";
import {
  HIST_QUOTA_ABORT_FLOOR,
  HIST_QUOTA_SAFETY_MARGIN,
  resolveHistSyncTier,
} from "./preflight";

const normal = resolveHistSyncTier(100, true);
assert.equal(normal.syncMode, "normal");
assert.equal(normal.abort, false);
assert.equal(normal.recommendedMaxChunks, 3);
assert.ok(normal.maxEnrichToday >= 16);

const conservative = resolveHistSyncTier(30, true);
assert.equal(conservative.syncMode, "conservative");
assert.equal(conservative.abort, false);
assert.equal(conservative.recommendedMaxChunks, 1);
assert.ok(conservative.maxEnrichToday >= 1);
assert.ok(conservative.maxEnrichToday <= 5);

const minimal = resolveHistSyncTier(10, true);
assert.equal(minimal.syncMode, "minimal");
assert.equal(minimal.abort, false);
assert.equal(minimal.maxEnrichToday, 1);
assert.equal(minimal.recommendedMaxChunks, 1);

const abortLow = resolveHistSyncTier(HIST_QUOTA_ABORT_FLOOR - 1, true);
assert.equal(abortLow.syncMode, "abort");
assert.equal(abortLow.abort, true);

const abortHealth = resolveHistSyncTier(100, false);
assert.equal(abortHealth.syncMode, "abort");
assert.equal(abortHealth.abort, true);

const atMargin = resolveHistSyncTier(HIST_QUOTA_SAFETY_MARGIN, true);
assert.equal(atMargin.syncMode, "normal");
assert.equal(atMargin.abort, false);

const justBelowNormal = resolveHistSyncTier(HIST_QUOTA_SAFETY_MARGIN - 1, true);
assert.equal(justBelowNormal.syncMode, "conservative");
assert.equal(justBelowNormal.abort, false);

console.log("hist preflight tests passed");
