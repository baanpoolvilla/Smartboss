import { z } from 'zod';
import { cursorPaginationSchema, isoDateTimeSchema, uuidSchema } from './common';

export const auditEventSchema = z.object({
  id: uuidSchema,
  occurred_at: isoDateTimeSchema,
  recorded_at: isoDateTimeSchema,
  actor_type: z.enum(['PRINCIPAL', 'DEVICE', 'SYSTEM', 'SUPPORT_OPERATOR']),
  actor_id: uuidSchema.nullable(),
  actor_display: z.string(),
  on_behalf_of_id: uuidSchema.nullable(),
  action: z.string(),
  resource_type: z.string(),
  resource_id: uuidSchema.nullable(),
  resource_version: z.number().int().nullable(),
  outcome: z.enum(['SUCCESS', 'DENIED', 'FAILED']),
  reason: z.string().nullable(),
  request_id: z.string().nullable(),
  company_id: uuidSchema.nullable(),
  /** redacted แล้วก่อนบันทึก (ADR-0009 ข้อ 3) */
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  metadata: z.record(z.unknown()),
});

export const listAuditEventsQuerySchema = cursorPaginationSchema.extend({
  action: z.string().min(1).max(120).optional(),
  resource_type: z.string().min(1).max(120).optional(),
  resource_id: uuidSchema.optional(),
  actor_id: uuidSchema.optional(),
  outcome: z.enum(['SUCCESS', 'DENIED', 'FAILED']).optional(),
  occurred_from: isoDateTimeSchema.optional(),
  occurred_to: isoDateTimeSchema.optional(),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;
