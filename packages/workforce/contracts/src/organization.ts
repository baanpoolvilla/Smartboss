import { z } from 'zod';
import {
  auditFieldsSchema,
  currencySchema,
  cursorPaginationSchema,
  statusSchema,
  timeZoneSchema,
  uuidSchema,
} from './common';

const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'code may contain letters, digits, dot, dash and underscore');

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------

export const createCompanySchema = z.object({
  code: codeSchema,
  legal_name: z.string().trim().min(1).max(200),
  display_name: z.string().trim().min(1).max(120),
  /** เลขประจำตัวผู้เสียภาษี — เก็บเข้ารหัส ไม่ส่งกลับใน response ปกติ */
  tax_id: z.string().trim().min(1).max(32).optional(),
  time_zone: timeZoneSchema.default('Asia/Bangkok'),
  currency: currencySchema.default('THB'),
});

export const updateCompanySchema = createCompanySchema
  .partial()
  .omit({ code: true })
  .extend({ status: statusSchema.optional() });

export const companySchema = z
  .object({
    id: uuidSchema,
    code: z.string(),
    legal_name: z.string(),
    display_name: z.string(),
    /** true = มีเลขผู้เสียภาษีบันทึกไว้ — ค่าจริงไม่ถูกส่งออก API */
    has_tax_id: z.boolean(),
    time_zone: z.string(),
    currency: z.string(),
    status: statusSchema,
  })
  .merge(auditFieldsSchema);

export const listCompaniesQuerySchema = cursorPaginationSchema.extend({
  status: statusSchema.optional(),
});

// ---------------------------------------------------------------------------
// Org unit
// ---------------------------------------------------------------------------

export const orgUnitKindSchema = z.enum(['DIVISION', 'DEPARTMENT', 'TEAM']);

export const createOrgUnitSchema = z.object({
  company_id: uuidSchema,
  parent_id: uuidSchema.nullable().default(null),
  code: codeSchema,
  name: z.string().trim().min(1).max(120),
  kind: orgUnitKindSchema.default('DEPARTMENT'),
});

export const orgUnitSchema = z
  .object({
    id: uuidSchema,
    company_id: uuidSchema,
    parent_id: uuidSchema.nullable(),
    code: z.string(),
    name: z.string(),
    kind: orgUnitKindSchema,
    status: statusSchema,
  })
  .merge(auditFieldsSchema);

export const listOrgUnitsQuerySchema = cursorPaginationSchema.extend({
  company_id: uuidSchema.optional(),
});

// ---------------------------------------------------------------------------
// Site
// ---------------------------------------------------------------------------

export const createSiteSchema = z
  .object({
    company_id: uuidSchema,
    code: codeSchema,
    name: z.string().trim().min(1).max(120),
    time_zone: timeZoneSchema.default('Asia/Bangkok'),
    latitude: z.number().min(-90).max(90).nullable().default(null),
    longitude: z.number().min(-180).max(180).nullable().default(null),
    /** รัศมีที่ยอมรับสำหรับ photo check-in (ใช้จริงใน Phase 3) */
    radius_m: z.number().int().positive().max(100_000).nullable().default(null),
  })
  .refine(
    (value) => (value.latitude === null) === (value.longitude === null),
    { message: 'latitude and longitude must be provided together', path: ['latitude'] },
  );

export const siteSchema = z
  .object({
    id: uuidSchema,
    company_id: uuidSchema,
    code: z.string(),
    name: z.string(),
    time_zone: z.string(),
    latitude: z.string().nullable(),
    longitude: z.string().nullable(),
    radius_m: z.number().int().nullable(),
    status: statusSchema,
  })
  .merge(auditFieldsSchema);

export const listSitesQuerySchema = cursorPaginationSchema.extend({
  company_id: uuidSchema.optional(),
});

// ---------------------------------------------------------------------------
// Position
// ---------------------------------------------------------------------------

export const createPositionSchema = z.object({
  company_id: uuidSchema,
  code: codeSchema,
  title: z.string().trim().min(1).max(120),
});

export const positionSchema = z
  .object({
    id: uuidSchema,
    company_id: uuidSchema,
    code: z.string(),
    title: z.string(),
    status: statusSchema,
  })
  .merge(auditFieldsSchema);

export const listPositionsQuerySchema = cursorPaginationSchema.extend({
  company_id: uuidSchema.optional(),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
export type Company = z.infer<typeof companySchema>;
export type CreateOrgUnitInput = z.infer<typeof createOrgUnitSchema>;
export type OrgUnit = z.infer<typeof orgUnitSchema>;
export type CreateSiteInput = z.infer<typeof createSiteSchema>;
export type Site = z.infer<typeof siteSchema>;
export type CreatePositionInput = z.infer<typeof createPositionSchema>;
export type Position = z.infer<typeof positionSchema>;
