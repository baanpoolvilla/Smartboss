import { z } from 'zod';
import {
  auditFieldsSchema,
  cursorPaginationSchema,
  isoDateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from './common';
import { eventIntentSchema } from './ingestion';

// ---------------------------------------------------------------------------
// Attendance policy group
// ---------------------------------------------------------------------------

export const attendanceMethodSchema = z.enum([
  'FINGERPRINT_DEVICE',
  'MOBILE_PHOTO',
  'WEB',
  'MANUAL',
]);

export const createPolicyGroupSchema = z.object({
  company_id: uuidSchema,
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
  allowed_methods: z.array(attendanceMethodSchema).min(1).default(['FINGERPRINT_DEVICE']),
  photo_required: z.enum(['ALWAYS', 'RANDOM', 'RISK_BASED', 'DISABLED']).default('DISABLED'),
  photo_random_percent: z.number().int().min(0).max(100).default(0),
  location_required: z.boolean().default(true),
  allowed_site_ids: z.array(uuidSchema).default([]),
  radius_m: z.number().int().positive().max(100_000).default(200),
  max_accuracy_m: z.number().int().positive().max(10_000).default(100),
  capture_deadline_seconds: z.number().int().min(5).max(600).default(30),
  allow_offline_capture: z.boolean().default(false),
  offline_max_age_minutes: z.number().int().positive().max(43_200).default(120),
  require_enrolled_device: z.boolean().default(true),
  require_live_capture: z.boolean().default(true),
  risk_action: z.enum(['WARN', 'REVIEW', 'REJECT']).default('REVIEW'),
  /** ค่าเริ่มต้น 90 วันตามที่เสนอใน DPIA — ต้องได้รับอนุมัติก่อน production (spec §16) */
  photo_retention_days: z.number().int().positive().max(3650).default(90),
  effective_from: isoDateSchema,
  effective_to: isoDateSchema.nullable().default(null),
});

export const policyGroupSchema = createPolicyGroupSchema
  .extend({ id: uuidSchema })
  .merge(auditFieldsSchema);

export const assignPolicyGroupSchema = z.object({
  employment_id: uuidSchema,
  effective_from: isoDateSchema,
  effective_to: isoDateSchema.nullable().default(null),
  supersede_current: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Mobile device registration (spec §6.4)
// ---------------------------------------------------------------------------

export const enrollMobileDeviceSchema = z.object({
  /** ตัวระบุที่แอปสร้างเอง — ไม่ใช่ IMEI หรือ advertising id */
  device_fingerprint: z.string().trim().min(8).max(200),
  platform: z.enum(['android', 'ios', 'web']),
  model: z.string().trim().max(100).nullable().default(null),
  app_version: z.string().trim().max(50).nullable().default(null),
  attestation_status: z.enum(['VERIFIED', 'FAILED', 'UNAVAILABLE']).default('UNAVAILABLE'),
});

export const mobileDeviceSchema = z
  .object({
    id: uuidSchema,
    employment_id: uuidSchema,
    platform: z.string(),
    model: z.string().nullable(),
    app_version: z.string().nullable(),
    attestation_status: z.string(),
    status: z.enum(['PENDING', 'ACTIVE', 'REVOKED', 'REPLACED']),
    approved_at: isoDateTimeSchema.nullable(),
    last_used_at: isoDateTimeSchema.nullable(),
  })
  .merge(auditFieldsSchema);

export const requestReplacementSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const approveMobileDeviceSchema = z.object({
  reason: z.string().trim().max(500).default(''),
});

// ---------------------------------------------------------------------------
// Photo check-in session (spec §13 — create / evidence / commit)
// ---------------------------------------------------------------------------

export const createSessionSchema = z.object({
  event_intent: eventIntentSchema.default('AUTO'),
  device_fingerprint: z.string().trim().min(8).max(200).nullable().default(null),
});

export const sessionSchema = z.object({
  id: uuidSchema,
  employment_id: uuidSchema,
  event_intent: eventIntentSchema,
  status: z.enum(['OPEN', 'EVIDENCE_ATTACHED', 'COMMITTED', 'EXPIRED', 'ABANDONED']),
  expires_at: isoDateTimeSchema,
  created_at: isoDateTimeSchema,
  /** นโยบายที่มีผลกับผู้ใช้คนนี้ ณ ตอนนี้ — ให้แอปรู้ว่าต้องขออะไรบ้าง */
  policy: z
    .object({
      photo_required: z.string(),
      location_required: z.boolean(),
      capture_deadline_seconds: z.number().int(),
      require_live_capture: z.boolean(),
      max_accuracy_m: z.number().int(),
    })
    .nullable(),
});

export const attachEvidenceSchema = z.object({
  /**
   * ภาพ JPEG/PNG เข้ารหัส base64 — Phase 3 ใช้ JSON เพื่อให้ retry ง่าย
   * ขอบล่างตั้งไว้หลวม ๆ กันสตริงว่าง; ขนาดจริงถูกตรวจจาก byte ที่ decode แล้วในชั้น service
   */
  photo_base64: z.string().min(32).max(12_000_000),
  content_type: z.enum(['image/jpeg', 'image/png']),
  captured_at_client: isoDateTimeSchema,
  /** false = เลือกจาก gallery; strict policy จะปฏิเสธ (spec §6.3) */
  live_capture: z.boolean().default(true),
});

export const commitSessionSchema = z.object({
  captured_at_client: isoDateTimeSchema,
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracy_m: z.number().min(0).max(100_000),
    })
    .nullable()
    .default(null),
  mock_location_suspected: z.boolean().default(false),
  app_version: z.string().max(50).nullable().default(null),
});

export const commitResultSchema = z.object({
  session_id: uuidSchema,
  /** null เมื่อถูกปฏิเสธ — ไม่มีเวลาทำงานเกิดขึ้น แต่หลักฐานยังถูกเก็บ */
  event_id: uuidSchema.nullable(),
  decision: z.enum(['ACCEPTED', 'ACCEPTED_WITH_WARNING', 'PENDING_REVIEW', 'REJECTED_POLICY']),
  risk_flags: z.array(z.string()),
  score: z.number().int(),
  matched_site_id: uuidSchema.nullable(),
  distance_from_site_m: z.number().nullable(),
  captured_at: isoDateTimeSchema,
  server_time: isoDateTimeSchema,
});

// ---------------------------------------------------------------------------
// Evidence review (spec §6.4 review queue)
// ---------------------------------------------------------------------------

export const riskAssessmentSchema = z.object({
  id: uuidSchema,
  session_id: uuidSchema.nullable(),
  raw_time_event_id: uuidSchema.nullable(),
  employment_id: uuidSchema,
  decision: z.string(),
  risk_flags: z.array(z.string()),
  score: z.number().int(),
  details: z.record(z.unknown()),
  reviewed_at: isoDateTimeSchema.nullable(),
  review_outcome: z.string().nullable(),
  review_reason: z.string().nullable(),
  created_at: isoDateTimeSchema,
});

export const listRiskAssessmentsQuerySchema = cursorPaginationSchema.extend({
  decision: z.string().optional(),
  employment_id: uuidSchema.optional(),
  unreviewed_only: z.coerce.boolean().default(false),
});

export const reviewRiskAssessmentSchema = z.object({
  outcome: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().trim().min(1).max(500),
});

/** signed URL อายุสั้น — ไม่ใช่ public URL (ADR-0010) */
export const evidenceDownloadSchema = z.object({
  url: z.string(),
  expires_at: isoDateTimeSchema,
});

export type CreatePolicyGroupInput = z.infer<typeof createPolicyGroupSchema>;
export type EnrollMobileDeviceInput = z.infer<typeof enrollMobileDeviceSchema>;
export type CommitSessionInput = z.infer<typeof commitSessionSchema>;
export type CommitResult = z.infer<typeof commitResultSchema>;
