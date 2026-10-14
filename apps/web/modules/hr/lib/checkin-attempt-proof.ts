import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * ใบยืนยันว่า "กดลงเวลาแล้วแต่ไม่ผ่าน" — หลักฐานว่าพนักงานพยายามลงเวลาจริง ตอนกี่โมง อยู่ตรงไหน
 *
 * api/m/checkin ออกให้ทุกครั้งที่ลงเวลาไม่ผ่าน (GPS ไม่ตรง ระบบบุคคลล่ม ฯลฯ) เครื่องเก็บไว้ แล้วแนบไปกับ
 * "ลงเวลาไม่ได้ · แจ้งไอที" (api/m/checkin-issue) ซึ่งตรวจลายเซ็นก่อนใส่ในตั๋ว
 * ทำไมต้องเซ็น: เวลา/พิกัดที่เครื่องส่งมาเองแก้ได้ — ใบนี้เวลามาจากนาฬิกาเซิร์ฟเวอร์ และแก้ค่าใดก็ตรวจไม่ผ่าน
 * ไม่ต้องเก็บลงฐานข้อมูล (ไม่มีตารางใหม่ ไม่มีจุดเขียนพร้อมกันตอนทุกคนลงเวลา 8 โมง)
 */

export interface CheckinAttempt {
  /** core.users.id — ใบของคนอื่นใช้ไม่ได้ */
  userId: string;
  /** AUTO = ให้ระบบเลือกเข้า/ออกเอง */
  intent: "CLOCK_IN" | "CLOCK_OUT" | "AUTO";
  /** ISO เวลาเซิร์ฟเวอร์ตอนรับคำขอ */
  at: string;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  /** ข้อความที่หน้าจอได้รับ (เหตุผลที่ไม่ผ่าน) */
  reason: string;
}

/** ใบเก่ากว่านี้ไม่รับ — หลักฐานของวันนี้/เมื่อวาน ไม่ใช่ของเดือนก่อน */
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.JWT_SECRET ?? process.env.AUTH_SMARTBOSS_SECRET;
  if (!value) throw new Error("JWT_SECRET is not configured");
  return value;
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(`checkin-attempt:${body}`).digest("base64url");
}

export function signCheckinAttempt(attempt: Omit<CheckinAttempt, "at">): string {
  const body = Buffer.from(JSON.stringify({ ...attempt, at: new Date().toISOString() })).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** null = ลายเซ็นไม่ตรง / ของคนอื่น / เก่าเกิน / รูปแบบผิด */
export function verifyCheckinAttempt(token: string, userId: string): CheckinAttempt | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const attempt = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CheckinAttempt;
    if (attempt.userId !== userId) return null;
    const age = Date.now() - new Date(attempt.at).getTime();
    if (!(age >= 0 && age <= MAX_AGE_MS)) return null;
    return attempt;
  } catch {
    return null;
  }
}
