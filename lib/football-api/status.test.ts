import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeFootballStatus } from "./status";

test("normalizeFootballStatus maps plan and remaining without inventing", () => {
  const n = normalizeFootballStatus({
    account: { firstname: "A", lastname: "B", email: "a@b.c" },
    subscription: { plan: "Free", active: true, end: "2027-01-01" },
    requests: { current: 10, limit_day: 100 },
  });
  assert.equal(n.plan, "Free");
  assert.equal(n.subscriptionActive, true);
  assert.equal(n.requests?.current, 10);
  assert.equal(n.requests?.limitDay, 100);
  assert.equal(n.requests?.remaining, 90);
});

test("normalizeFootballStatus omits requests when absent", () => {
  const n = normalizeFootballStatus({ subscription: { plan: "Pro" } });
  assert.equal(n.plan, "Pro");
  assert.equal(n.requests, undefined);
});
