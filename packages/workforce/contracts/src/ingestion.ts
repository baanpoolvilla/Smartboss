import { z } from 'zod';
import { cursorPaginationSchema, isoDateTimeSchema, uuidSchema } from './common';

export const eventIntentSchema = z.enum([
  'AUTO',
  'CLOCK_IN',
  'CLOCK_OUT',
  'BREAK_START',
  'BREAK_END',
  'SITE_CHECK_IN',
  'SITE_CHECK_OUT',
]);

/**
 * Event หนึ่งรายการที่เครื่องส่งมา (spec §6.1)
 *
 * `event_id` และ `sequence` สร้างที่เครื่อง ไม่ใช่ที่ server — เครื่องที่ offline
 * ต้องสร้าง id ได้เองแล้วค่อยส่งภายหลัง
 */
export const deviceTimeEventSchema = z.object({
  event_id: uuidSchema,
  sequence: z.number().int().nonnegative(),
  captured_at: isoDateTimeSchema,
  timezone: z.string().min(1).max(64).default('Asia/Bangkok'),
  event_intent: eventIntentSchema.default('AUTO'),
  /** slot ของ template ในเครื่อง — server map เป็น employment เอง */
  template_slot: z.number().int().min(0).max(65_535).nullable().default(null),
  evidence: z
    .object({
      match_score: z.number().int().min(0).max(100).optional(),
      sensor_quality: z.number().int().min(0).max(100).optional(),
    })
    .passthrough()
    .default({}),
});

export const deviceBatchSchema = z.object({
  batch_id: uuidSchema,
  /** เวลาที่เครื่องคิดว่าเป็นตอนนี้ — ใช้คำนวณ clock drift เท่านั้น */
  device_time: isoDateTimeSchema,
  firmware_version: z.string().max(50).optional(),
  config_version: z.number().int().optional(),
  queue_depth: z.number().int().nonnegative().default(0),
  events: z.array(deviceTimeEventSchema).min(1).max(500),
});

/**
 * ชื่อคนที่เพิ่งสแกน ส่งกลับให้เครื่องขึ้นจอ
 *
 * เดิมเครื่องรู้แค่หมายเลข slot ของตัวเอง จอจึงขึ้นได้แค่ "ID:1" ซึ่งคนหน้าเครื่อง
 * ยืนยันไม่ได้ว่าระบบจับเป็นตัวเองจริงไหม
 *
 * ⚠ นี่คือการยอมให้ชื่อพนักงานออกไปอยู่ที่ตัวเครื่อง — ตัดสินใจไว้แล้วว่ารับได้
 * เพราะชื่อไม่ใช่ biometric template และคนที่ยืนหน้าเครื่องก็เห็นหน้ากันอยู่แล้ว
 * แต่ **ส่งเฉพาะคนที่เพิ่งสแกนใน batch นี้** ห้ามทำเป็น endpoint แจกรายชื่อทั้งบริษัท
 */
export const resolvedScanSchema = z.object({
  sequence: z.number().int(),
  /** null = slot นั้นยังไม่ถูกผูกกับใคร — เครื่องต้องเตือน ไม่ใช่ขึ้นว่าบันทึกแล้วเฉย ๆ */
  display_name: z.string().nullable(),
});

export const ingestResultSchema = z.object({
  batch_id: uuidSchema,
  accepted: z.number().int(),
  duplicates: z.number().int(),
  quarantined: z.number().int(),
  /** เครื่องลบ event ที่ sequence ≤ ค่านี้ออกจากคิวได้ (spec §6.2 ข้อ 8) */
  acked_sequence: z.number().int().nullable(),
  server_time: isoDateTimeSchema,
  clock_drift_ms: z.number().int(),
  /** เรียงตาม sequence เดียวกับที่เครื่องส่งมา */
  resolved: z.array(resolvedScanSchema).default([]),
});

export const heartbeatSchema = z.object({
  device_time: isoDateTimeSchema,
  queue_depth: z.number().int().nonnegative().default(0),
  template_count: z.number().int().nonnegative().default(0),
  firmware_version: z.string().max(50).optional(),
  config_version: z.number().int().optional(),
  metrics: z.record(z.unknown()).default({}),
});

export const syncStateSchema = z.object({
  device_id: uuidSchema,
  acked_sequence: z.number().int().nullable(),
  config_version: z.number().int(),
  pending_command_count: z.number().int(),
  server_time: isoDateTimeSchema,
});

/**
 * Legacy adapter (spec §13)
 *
 * รูปแบบเดียวกับ `POST /api/attendance` ของระบบเดิมทุกประการ เพื่อให้ firmware
 * ที่ยังไม่ได้อัปเดตส่งเข้ามาได้ระหว่าง parallel run — event จะถูกทำเครื่องหมาย
 * `LEGACY_UNTRUSTED` และต้อง retire หลัง backlog = 0
 */
export const legacyAttendanceSchema = z.object({
  device_id: z.string().min(1).max(50),
  finger_id: z.coerce.number().int().min(0).max(65_535),
});

export const rawTimeEventSchema = z.object({
  id: uuidSchema,
  company_id: uuidSchema,
  employment_id: uuidSchema.nullable(),
  source_type: z.string(),
  source_id: uuidSchema.nullable(),
  event_intent: eventIntentSchema,
  captured_at: isoDateTimeSchema,
  received_at: isoDateTimeSchema,
  timezone: z.string(),
  sequence: z.number().int().nullable(),
  status: z.enum(['ACCEPTED', 'QUARANTINED']),
  quarantine_reason: z.string().nullable(),
  evidence: z.record(z.unknown()),
});

export const listRawEventsQuerySchema = cursorPaginationSchema.extend({
  employment_id: uuidSchema.optional(),
  source_id: uuidSchema.optional(),
  captured_from: isoDateTimeSchema.optional(),
  captured_to: isoDateTimeSchema.optional(),
  status: z.enum(['ACCEPTED', 'QUARANTINED']).optional(),
});

export type DeviceTimeEvent = z.infer<typeof deviceTimeEventSchema>;
export type DeviceBatch = z.infer<typeof deviceBatchSchema>;
export type IngestResult = z.infer<typeof ingestResultSchema>;
export type RawTimeEvent = z.infer<typeof rawTimeEventSchema>;
