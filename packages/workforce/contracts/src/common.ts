import { z } from 'zod';

export const API_BASE_PATH = '/api/workforce/v1';

/** UUID ทุกตัวในระบบเป็น v7 แต่ validate เป็น uuid ทั่วไปเพื่อไม่ปฏิเสธ id ที่ import มา */
export const uuidSchema = z.string().uuid();

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const isoDateTimeSchema = z.string().datetime({ offset: true });

/**
 * เงินเดินทางเป็น string เสมอ (spec §13, ADR-0007)
 * ปฏิเสธ number ตั้งแต่ชั้น validation เพื่อไม่ให้ค่าที่เสียความแม่นยำแล้วหลุดเข้าระบบ
 */
export const moneySchema = z
  .string()
  .regex(/^-?\d{1,15}(\.\d{1,4})?$/, 'expected decimal string with at most 4 decimal places');

export const rateSchema = z
  .string()
  .regex(/^-?\d{1,9}(\.\d{1,6})?$/, 'expected decimal string with at most 6 decimal places');

export const currencySchema = z.string().length(3).toUpperCase();

export const timeZoneSchema = z.string().min(1).max(64);

export const cursorPaginationSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CursorPagination = z.infer<typeof cursorPaginationSchema>;

export function pageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    next_cursor: z.string().nullable(),
  });
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

/** RFC 9457 problem details — error shape เดียวทั้งระบบ (spec §13) */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string(),
  request_id: z.string().optional(),
  errors: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
  meta: z.record(z.unknown()).optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const effectivePeriodSchema = z.object({
  effective_from: isoDateSchema,
  effective_to: isoDateSchema.nullable().default(null),
});

export const auditFieldsSchema = z.object({
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  version: z.number().int(),
});

export const statusSchema = z.enum(['ACTIVE', 'INACTIVE']);
