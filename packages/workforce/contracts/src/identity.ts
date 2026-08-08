import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

/** ข้อมูลตัวตนของผู้เรียก — ใช้ให้ UI ตัดสินใจแสดงผล ไม่ใช่ security control */
export const meSchema = z.object({
  principal_id: uuidSchema,
  tenant_id: uuidSchema,
  display_name: z.string(),
  email: z.string().nullable(),
  employment_id: uuidSchema.nullable(),
  company_ids: z.array(uuidSchema),
  roles: z.array(z.object({ code: z.string(), name: z.string(), company_id: uuidSchema.nullable() })),
  permissions: z.array(z.string()),
  authenticated_at: isoDateTimeSchema,
  authentication_methods: z.array(z.string()),
  access_expires_at: isoDateTimeSchema.nullable(),
});

export type Me = z.infer<typeof meSchema>;

export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  service: z.string(),
  time: isoDateTimeSchema,
});

export const readinessSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  checks: z.array(
    z.object({
      name: z.string(),
      status: z.enum(['ok', 'down']),
      detail: z.string().optional(),
    }),
  ),
});
