import { z } from 'zod';
import {
  auditFieldsSchema,
  cursorPaginationSchema,
  isoDateTimeSchema,
  timeZoneSchema,
  uuidSchema,
} from './common';

export const deviceStatusSchema = z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED']);

export const createDeviceSchema = z.object({
  company_id: uuidSchema,
  device_code: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().trim().max(120).default(''),
  site_id: uuidSchema.nullable().default(null),
  device_type: z.enum(['FINGERPRINT_TERMINAL', 'KIOSK', 'GATEWAY']).default('FINGERPRINT_TERMINAL'),
  time_zone: timeZoneSchema.default('Asia/Bangkok'),
});

export const deviceSchema = z
  .object({
    id: uuidSchema,
    company_id: uuidSchema,
    device_code: z.string(),
    name: z.string(),
    site_id: uuidSchema.nullable(),
    device_type: z.string(),
    status: deviceStatusSchema,
    time_zone: z.string(),
    firmware_version: z.string().nullable(),
    config_version: z.number().int(),
    last_seen_at: isoDateTimeSchema.nullable(),
    has_active_credential: z.boolean(),
  })
  .merge(auditFieldsSchema);

export const listDevicesQuerySchema = cursorPaginationSchema.extend({
  company_id: uuidSchema.optional(),
  status: deviceStatusSchema.optional(),
});

/** ตอบกลับตอนสร้าง activation token — token ตัวจริงแสดงครั้งเดียวเท่านั้น */
export const activationTokenSchema = z.object({
  device_id: uuidSchema,
  activation_token: z.string(),
  expires_at: isoDateTimeSchema,
});

export const issueActivationTokenSchema = z.object({
  ttl_seconds: z.number().int().min(60).max(86_400).default(3600),
});

export const revokeDeviceSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

/** เครื่องส่ง public key ของตัวเองมาแลกกับ token ที่ใช้ได้ครั้งเดียว */
export const deviceActivationRequestSchema = z.object({
  activation_token: z.string().min(20).max(200),
  public_key: z.string().min(40).max(200),
  firmware_version: z.string().max(50).optional(),
});

export const deviceActivationResponseSchema = z.object({
  device_id: uuidSchema,
  tenant_id: uuidSchema,
  company_id: uuidSchema,
  device_code: z.string(),
  time_zone: z.string(),
  config_version: z.number().int(),
  server_time: isoDateTimeSchema,
});

// ---------------------------------------------------------------------------
// Biometric enrolment — reference only, never templates (spec §6.2)
// ---------------------------------------------------------------------------

export const requestEnrollmentSchema = z.object({
  employment_id: uuidSchema,
  device_id: uuidSchema,
  template_slot: z.number().int().min(0).max(65_535),
  finger_position: z.string().max(30).nullable().default(null),
  ttl_seconds: z.number().int().min(60).max(3600).default(600),
});

export const biometricEnrollmentSchema = z.object({
  id: uuidSchema,
  employment_id: uuidSchema,
  device_id: uuidSchema,
  template_slot: z.number().int(),
  template_version: z.number().int(),
  quality: z.number().int().nullable(),
  finger_position: z.string().nullable(),
  status: z.enum(['PENDING', 'ACTIVE', 'DELETED']),
  enrolled_at: isoDateTimeSchema.nullable(),
  deleted_at: isoDateTimeSchema.nullable(),
  created_at: isoDateTimeSchema,
});

export const deleteEnrollmentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const deviceCommandSchema = z.object({
  id: uuidSchema,
  command_type: z.enum([
    'ENROLL_BIOMETRIC',
    'DELETE_BIOMETRIC',
    'CLEAR_SENSOR',
    'UPDATE_CONFIG',
    'REBOOT',
  ]),
  payload: z.record(z.unknown()),
  nonce: z.string(),
  expires_at: isoDateTimeSchema,
  created_at: isoDateTimeSchema,
});

export const ackCommandSchema = z.object({
  nonce: z.string().min(1),
  outcome: z.enum(['SUCCESS', 'FAILED']),
  result: z.record(z.unknown()).default({}),
  /**
   * hash ของ template ที่อยู่ในเครื่องหลัง enroll สำเร็จ
   * ใช้ยืนยันว่า slot ตรงกัน — ไม่ใช่ตัว template (spec §6.2 ห้ามส่ง template plaintext)
   */
  template_hash: z.string().max(128).optional(),
  quality: z.number().int().min(0).max(100).optional(),
});

export type CreateDeviceInput = z.infer<typeof createDeviceSchema>;
export type Device = z.infer<typeof deviceSchema>;
export type BiometricEnrollment = z.infer<typeof biometricEnrollmentSchema>;
