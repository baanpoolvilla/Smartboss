import { test } from "node:test";
import assert from "node:assert/strict";
import { base32Decode, base32Encode, generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode, totpCode, verifyTotp } from "../totp";

// RFC 6238 ภาคผนวก B (SHA-1, secret "12345678901234567890") — ตัดเหลือ 6 หลักท้าย
const SECRET = base32Encode(Buffer.from("12345678901234567890"));

test("ตรงกับเวกเตอร์ทดสอบใน RFC 6238", () => {
  assert.equal(totpCode(SECRET, Math.floor(59 / 30)), "287082");
  assert.equal(totpCode(SECRET, Math.floor(1111111109 / 30)), "081804");
  assert.equal(totpCode(SECRET, Math.floor(1234567890 / 30)), "005924");
  assert.equal(totpCode(SECRET, Math.floor(2000000000 / 30)), "279037");
});

test("base32 ไป-กลับได้ค่าเดิม", () => {
  assert.equal(base32Decode(SECRET).toString(), "12345678901234567890");
});

test("ยอมนาฬิกาเพี้ยน 1 ช่วง แต่ไม่เกินนั้น", () => {
  const now = 1111111109 * 1000;
  assert.notEqual(verifyTotp(SECRET, "081804", { nowMs: now }), null);
  assert.notEqual(verifyTotp(SECRET, "081804", { nowMs: now + 30_000 }), null);
  assert.equal(verifyTotp(SECRET, "081804", { nowMs: now + 90_000 }), null);
  assert.equal(verifyTotp(SECRET, "000000", { nowMs: now }), null);
  assert.equal(verifyTotp(SECRET, "abc", { nowMs: now }), null);
});

test("รหัสเดิมใช้ซ้ำไม่ได้", () => {
  const now = 1111111109 * 1000;
  const step = verifyTotp(SECRET, "081804", { nowMs: now });
  assert.equal(verifyTotp(SECRET, "081804", { nowMs: now, afterStep: step }), null);
});

test("รหัสสำรอง", () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  assert.ok(codes.every((c) => /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(c)));
  assert.equal(hashRecoveryCode(codes[0]!), hashRecoveryCode(codes[0]!.toLowerCase().replace("-", " ")));
  assert.equal(looksLikeRecoveryCode("123456"), false);
});
