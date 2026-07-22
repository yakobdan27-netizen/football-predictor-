import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adminSessionToken,
  isValidAdminToken,
  secretsEqual,
  tokensMatch,
} from "./auth";

test("secretsEqual accepts matching passwords", () => {
  assert.equal(secretsEqual("admin-secret", "admin-secret"), true);
  assert.equal(secretsEqual("admin-secret", "wrong"), false);
});

test("admin session token validates", () => {
  const prev = process.env.ADMIN_SECRET;
  process.env.ADMIN_SECRET = "test-admin-secret";
  try {
    const token = adminSessionToken("test-admin-secret");
    assert.equal(isValidAdminToken(token), true);
    assert.equal(isValidAdminToken("deadbeef"), false);
    assert.equal(tokensMatch(token, adminSessionToken("test-admin-secret")), true);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = prev;
  }
});
