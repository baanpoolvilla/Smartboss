import { randomBytes, randomUUID } from 'node:crypto';

/**
 * UUIDv7 — 48-bit Unix epoch ms + version/variant + randomness (RFC 9562).
 *
 * เลือก v7 แทน v4 เพราะเรียงตามเวลา ทำให้ B-tree index มี locality
 * (insert ไปที่หน้าเดียวกัน ไม่กระจายทั้ง index เหมือน v4)
 * และแทน SERIAL เพราะ SERIAL รั่วข้อมูลปริมาณธุรกิจออกทาง API
 *
 * ดู ADR-0002
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let lastTimestampMs = -1;
let lastCounter = 0;

/**
 * สร้าง UUIDv7
 *
 * ภายใน millisecond เดียวกันใช้ counter 12 บิตเพิ่มทีละ 1 เพื่อรับประกันว่า
 * id ที่สร้างติดกันเรียงลำดับถูกต้อง (v7 ธรรมดาที่สุ่มล้วนไม่รับประกันข้อนี้)
 * ซึ่งจำเป็นกับ raw time event ที่ใช้ลำดับในการจับคู่ punch
 */
export function uuidv7(now: number = Date.now()): string {
  let timestampMs = now;

  if (timestampMs === lastTimestampMs) {
    lastCounter += 1;
    if (lastCounter > 0xfff) {
      // counter ล้นภายใน ms เดียว — ขยับไป ms ถัดไปแทนการวนกลับ
      timestampMs = lastTimestampMs + 1;
      lastTimestampMs = timestampMs;
      lastCounter = 0;
    }
  } else if (timestampMs > lastTimestampMs) {
    lastTimestampMs = timestampMs;
    lastCounter = 0;
  } else {
    // นาฬิกาเดินถอยหลัง (NTP step) — ห้ามสร้าง id ที่เรียงถอยหลัง
    timestampMs = lastTimestampMs;
    lastCounter += 1;
    if (lastCounter > 0xfff) {
      timestampMs = lastTimestampMs + 1;
      lastTimestampMs = timestampMs;
      lastCounter = 0;
    }
  }

  const bytes = randomBytes(16);
  const ts = BigInt(timestampMs);

  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);

  // version 7 + counter 12 บิตใน rand_a
  bytes[6] = 0x70 | ((lastCounter >> 8) & 0x0f);
  bytes[7] = lastCounter & 0xff;

  // variant RFC 4122 (10xx)
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** ดึงเวลาที่ id ถูกสร้าง — ใช้ debug/forensics ห้ามใช้เป็น business timestamp */
export function uuidv7Timestamp(id: string): Date {
  const hex = id.replace(/-/g, '').slice(0, 12);
  return new Date(Number(BigInt(`0x${hex}`)));
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** UUIDv4 สำหรับค่าที่ต้องไม่เรียงตามเวลา เช่น nonce, activation token id */
export function uuidv4(): string {
  return randomUUID();
}
