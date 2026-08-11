import assert from "node:assert/strict";
import {
  canTransitionCoreTraceStatus,
  coreStatusFromLogState,
} from "./result-trace-status";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`fail - ${name}`);
    throw e;
  }
}

test("maps log states to core statuses", () => {
  assert.equal(coreStatusFromLogState("PENDING"), "pending");
  assert.equal(coreStatusFromLogState("RETRY"), "unresolved");
  assert.equal(coreStatusFromLogState("FOUND_NOT_FINAL"), "not_final");
  assert.equal(coreStatusFromLogState("AMBIGUOUS"), "ambiguous");
  assert.equal(coreStatusFromLogState("NEEDS_REVIEW"), "ambiguous");
  assert.equal(coreStatusFromLogState("FILLED"), "filled");
});

test("filled is terminal", () => {
  assert.equal(canTransitionCoreTraceStatus("filled", "pending"), false);
  assert.equal(canTransitionCoreTraceStatus("pending", "filled"), true);
  assert.equal(canTransitionCoreTraceStatus("filled", "filled"), true);
});

console.log("result-trace-status tests passed");
