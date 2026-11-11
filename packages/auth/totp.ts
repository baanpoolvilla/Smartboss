import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * ยืนยันตัวตน 2 ชั้นด้วยแอป Authenticator (TOTP — RFC 6238: SHA-1, 6 หลัก, เปลี่ยนทุก 30 วินาที)
 * ค่ามาตรฐานที่ Google Authenticator / Microsoft Authenticator / Authy / 1Password ใช้ตรงกันหมด
 * เขียนเองด้วย node:crypto ไม่เพิ่ม dependency — ตัวอัลกอริทึมสั้นและมีเวกเตอร์ทดสอบใน RFC (__tests__/totp.test.ts)
 */
const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** secret ใหม่ 20 ไบต์ (160 บิต ตามที่ RFC 4226 แนะนำ) ในรูป base32 ที่แอปรับ */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

export function totpCode(secretBase32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * ตรวจรหัส 6 หลัก — ยอมช่วงก่อน/หลัง 1 ช่วง (นาฬิกามือถือเพี้ยนได้ ±30 วินาที)
 * คืนเลขช่วงที่ตรง (ให้ผู้เรียกเก็บไว้กันรหัสเดิมถูกใช้ซ้ำ) หรือ null ถ้าไม่ตรง
 * `afterStep` = ช่วงล่าสุดที่เคยใช้ผ่านแล้ว — รหัสของช่วงนั้นหรือก่อนหน้าใช้ซ้ำไม่ได้
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  opts: { afterStep?: number | null; nowMs?: number } = {}
): number | null {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const current = totpStep(opts.nowMs);
  for (const step of [current, current - 1, current + 1]) {
    if (opts.afterStep != null && step <= opts.afterStep) continue;
    const expected = Buffer.from(totpCode(secretBase32, step));
    if (timingSafeEqual(expected, Buffer.from(clean))) return step;
  }
  return null;
}

/** ลิงก์ที่แอป Authenticator อ่านได้ (ทำเป็น QR หรือกดเปิดแอปบนมือถือเครื่องเดียวกัน) */
export function totpUri(secretBase32: string, account: string, issuer = "SmartBoss"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/* ── รหัสสำรอง — ใช้แทนรหัส 6 หลักได้ครั้งเดียวต่อรหัส เมื่อมือถือหาย/เปลี่ยนเครื่อง ── */

const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // ตัด I L O 0 1 ที่อ่านสับสน

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

function normalizeRecovery(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** รหัสสำรองสุ่ม ~49 บิต — เดาไม่ได้ในทางปฏิบัติ จึงใช้ SHA-256 ธรรมดาได้ (ต่างจากรหัสผ่านที่คนตั้งเอง) */
export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecovery(code)).digest("hex");
}

export function looksLikeRecoveryCode(code: string): boolean {
  return normalizeRecovery(code).length === 10 && !/^\d+$/.test(normalizeRecovery(code));
}
