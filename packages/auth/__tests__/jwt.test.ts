import { test } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? "test-secret-at-least-32-characters-long-xx";

const { signAccessToken, verifyAccessToken } = await import("../jwt.ts");

test("sign + verify round-trip preserves claims", async () => {
  const token = await signAccessToken({
    sub: "user-1",
    orgId: "org-1",
    roles: ["SUPER_ADMIN"],
    permissions: ["hr.leave.approve"],
  });
  const claims = await verifyAccessToken(token);
  assert.ok(claims);
  assert.equal(claims!.sub, "user-1");
  assert.equal(claims!.orgId, "org-1");
  assert.deepEqual(claims!.roles, ["SUPER_ADMIN"]);
  assert.deepEqual(claims!.permissions, ["hr.leave.approve"]);
});

test("verify rejects a tampered token", async () => {
  const token = await signAccessToken({ sub: "u", orgId: null, roles: [], permissions: [] });
  const tampered = token.slice(0, -2) + "xx";
  const claims = await verifyAccessToken(tampered);
  assert.equal(claims, null);
});

test("verify rejects garbage", async () => {
  assert.equal(await verifyAccessToken("not-a-jwt"), null);
});
