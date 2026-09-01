import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * แฮชรหัสผ่านลิงก์แชร์แบบง่ายด้วย scrypt (built-in ไม่พึ่ง dependency) — เก็บเป็น
 * "saltHex:hashHex" นี่เป็น "รหัสกันเปิดลิงก์" ระดับความสะดวก ไม่ใช่รหัสผ่านบัญชี
 * แต่ก็ salt + timing-safe compare เพื่อไม่ให้เดา/เทียบเวลาได้ง่าย
 */
export function hashSharePassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifySharePasswordHash(stored: string, password: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
