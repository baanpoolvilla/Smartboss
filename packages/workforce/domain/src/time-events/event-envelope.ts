import { createHash } from 'node:crypto';

/**
 * เจตนาของการลงเวลา (spec §6.5)
 *
 * `SITE_CHECK_IN/OUT` ใช้ติดตามงานภาคสนาม และ **ไม่** เข้า payroll โดยอัตโนมัติ
 * จนกว่าจะถูก policy map หรืออนุมัติให้เป็น work punch
 */
export const EVENT_INTENTS = [
  'AUTO',
  'CLOCK_IN',
  'CLOCK_OUT',
  'BREAK_START',
  'BREAK_END',
  'SITE_CHECK_IN',
  'SITE_CHECK_OUT',
] as const;

export type EventIntent = (typeof EVENT_INTENTS)[number];

const PAYROLL_RELEVANT: ReadonlySet<EventIntent> = new Set<EventIntent>([
  'AUTO',
  'CLOCK_IN',
  'CLOCK_OUT',
  'BREAK_START',
  'BREAK_END',
]);

export function isPayrollRelevantIntent(intent: EventIntent): boolean {
  return PAYROLL_RELEVANT.has(intent);
}

export const SOURCE_TYPES = [
  'FINGERPRINT_DEVICE',
  'MOBILE_APP',
  'WEB',
  'MANUAL',
  'LEGACY_UNTRUSTED',
  'IMPORT',
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

/** Envelope ที่ทุกช่องทางต้องแปลงมาเป็นรูปแบบเดียวกัน (spec §6.1) */
export interface TimeEventEnvelope {
  event_id: string;
  employment_id: string | null;
  source_type: SourceType;
  source_id: string | null;
  event_intent: EventIntent;
  captured_at: string;
  timezone: string;
  sequence: number | null;
  evidence: Record<string, unknown>;
  client_context: Record<string, unknown>;
}

/**
 * Hash ของเนื้อหา event ที่มีผลต่อความหมาย
 *
 * ใช้ตัดสินว่า event ที่ sequence ซ้ำเป็น "retry ของเดิม" (hash ตรง → ตอบสำเร็จแบบ
 * idempotent) หรือ "ของใหม่ที่อ้าง sequence เดิม" (hash ต่าง → quarantine, spec §6.1)
 *
 * ไม่รวม `received_at` หรือ id ของ batch เพราะค่าพวกนั้นต่างกันทุกครั้งที่ retry
 */
export function computeEventPayloadHash(envelope: TimeEventEnvelope): Buffer {
  const canonical = JSON.stringify([
    envelope.event_id,
    envelope.employment_id,
    envelope.source_type,
    envelope.source_id,
    envelope.event_intent,
    // ทำให้รูปแบบเวลาเป็นมาตรฐานก่อน hash — '+07:00' กับ 'Z' ที่ชี้เวลาเดียวกันต้องได้ hash เดียวกัน
    new Date(envelope.captured_at).toISOString(),
    envelope.timezone,
    envelope.sequence,
    canonicalJson(envelope.evidence),
  ]);
  return createHash('sha256').update(canonical).digest();
}

/** เรียงคีย์ให้คงที่เพื่อให้ object เดิมได้ hash เดิมเสมอ */
export function canonicalJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalJson);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonicalJson(item)]),
  );
}

export interface ClockDriftAssessment {
  driftMs: number;
  /** เกินเกณฑ์ที่ยอมรับได้ → บันทึกเป็น anomaly แต่ไม่แก้เวลาที่เครื่องบันทึกไว้ */
  isAnomalous: boolean;
}

/**
 * ประเมิน clock drift ของเครื่อง
 *
 * spec §6.2: "Server time ใช้ตรวจ clock drift แต่ไม่ overwrite captured time"
 * ระบบเดิมใช้เวลาที่ server ได้รับเป็นเวลาทำงาน ทำให้ event ที่ sync ทีหลัง
 * ได้เวลาผิดทั้งหมด (spec §3.3 C8)
 */
export function assessClockDrift(
  deviceReportedAt: Date,
  serverReceivedAt: Date,
  toleranceMs: number,
): ClockDriftAssessment {
  const driftMs = deviceReportedAt.getTime() - serverReceivedAt.getTime();
  return { driftMs, isAnomalous: Math.abs(driftMs) > toleranceMs };
}

export interface OfflineAgeAssessment {
  ageMinutes: number;
  isTooOld: boolean;
}

/**
 * event ที่ offline นานเกินกำหนดต้องเข้า exception ไม่ใช่ถูกทิ้ง (spec §19.2)
 * และไม่ใช่ยอมรับเงียบ ๆ เพราะอาจเป็นการย้อนเวลาเข้ามาแก้ประวัติ
 */
export function assessOfflineAge(
  capturedAt: Date,
  receivedAt: Date,
  maxAgeMinutes: number,
): OfflineAgeAssessment {
  const ageMinutes = (receivedAt.getTime() - capturedAt.getTime()) / 60_000;
  return { ageMinutes, isTooOld: ageMinutes > maxAgeMinutes };
}
