import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADMIN_SECRET_HEADER,
  COOKIE_MAX_AGE_SECONDS,
  adminSessionToken,
  adminUnlockCookieOptions,
  isAuthorizedByHeader,
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

test("x-admin-secret header authorizes; mismatch rejected", () => {
  const prev = process.env.ADMIN_SECRET;
  process.env.ADMIN_SECRET = "header-secret-value";
  try {
    const ok = new Request("http://localhost/api/admin/manual-results", {
      headers: { [ADMIN_SECRET_HEADER]: "header-secret-value" },
    });
    assert.equal(isAuthorizedByHeader(ok), true);

    const bad = new Request("http://localhost/api/admin/manual-results", {
      headers: { [ADMIN_SECRET_HEADER]: "wrong" },
    });
    assert.equal(isAuthorizedByHeader(bad), false);

    const missing = new Request("http://localhost/api/admin/manual-results");
    assert.equal(isAuthorizedByHeader(missing), false);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = prev;
  }
});

test("unlock cookie is Strict with 8h maxAge", () => {
  const opts = adminUnlockCookieOptions("abc");
  assert.equal(opts.sameSite, "strict");
  assert.equal(opts.maxAge, COOKIE_MAX_AGE_SECONDS);
  assert.equal(COOKIE_MAX_AGE_SECONDS, 60 * 60 * 8);
  assert.equal(opts.httpOnly, true);
});
