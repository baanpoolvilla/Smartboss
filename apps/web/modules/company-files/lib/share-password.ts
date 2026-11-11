import "server-only";
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

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

/**
 * "ปลดล็อกแล้ว" ของลิงก์แชร์ที่ตั้งรหัสผ่าน — เก็บเป็น cookie (httpOnly) แทนการแนบรหัสผ่านไปกับ URL ของไฟล์
 * เดิมหน้าเว็บต่อ ?pw=<รหัส> ท้ายลิงก์ไฟล์ รหัสจึงไปค้างใน log ของเซิร์ฟเวอร์/ประวัติเบราว์เซอร์
 * ค่า cookie = HMAC ของ (token + hash รหัสผ่านปัจจุบัน) ด้วยกุญแจของเซิร์ฟเวอร์ — ปลอมเองไม่ได้
 * และเจ้าของเปลี่ยนรหัสผ่านลิงก์เมื่อไหร่ cookie เดิมใช้ไม่ได้ทันที
 */
export function shareUnlockCookieName(token: string): string {
  return `sb_share_${createHash("sha256").update(token).digest("hex").slice(0, 16)}`;
}

export function shareUnlockValue(token: string, passwordHash: string): string {
  const secret = process.env.JWT_SECRET ?? "";
  return createHmac("sha256", secret).update(`share-unlock:${token}:${passwordHash}`).digest("hex");
}

export function shareUnlockMatches(token: string, passwordHash: string, cookieValue: string | undefined | null): boolean {
  if (!cookieValue) return false;
  const expected = Buffer.from(shareUnlockValue(token, passwordHash));
  const actual = Buffer.from(cookieValue);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
