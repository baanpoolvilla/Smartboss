import { z } from 'zod';
import {
  auditFieldsSchema,
  currencySchema,
  cursorPaginationSchema,
  isoDateSchema,
  moneySchema,
  timeZoneSchema,
  uuidSchema,
} from './common';

// ---------------------------------------------------------------------------
// Person — ตัวคน แยกจากการจ้าง (ADR/schema §people)
// ---------------------------------------------------------------------------

export const createPersonSchema = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  /** ชื่อเล่น/ชื่อที่ใช้แสดง — แยกจากชื่อจริง (คงคุณสมบัติจากระบบเดิม) */
  preferred_name: z.string().trim().max(100).default(''),
  email: z.string().email().max(200).nullable().default(null),
  phone: z.string().trim().max(32).nullable().default(null),
  date_of_birth: isoDateSchema.nullable().default(null),
  /** ข้อมูลอ่อนไหว ม.26 — เก็บเข้ารหัส ไม่ส่งกลับใน response ใด ๆ */
  national_id: z.string().trim().min(1).max(32).nullable().default(null),
});

export const updatePersonSchema = createPersonSchema.partial();

export const personSchema = z
  .object({
    id: uuidSchema,
    first_name: z.string(),
    last_name: z.string(),
    preferred_name: z.string(),
    display_name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    date_of_birth: isoDateSchema.nullable(),
    has_national_id: z.boolean(),
    status: z.enum(['ACTIVE', 'INACTIVE']),
  })
  .merge(auditFieldsSchema);

export const listPeopleQuerySchema = cursorPaginationSchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
});

// ---------------------------------------------------------------------------
// Employment
// ---------------------------------------------------------------------------

export const employmentTypeSchema = z.enum([
  'MONTHLY',
  'DAILY',
  'HOURLY',
  'CONTRACT',
  'PART_TIME',
]);

export const employmentStatusSchema = z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED']);

export const createEmploymentSchema = z.object({
  company_id: uuidSchema,
  person_id: uuidSchema,
  employee_code: z.string().trim().min(1).max(32),
  employment_type: employmentTypeSchema,
  hired_on: isoDateSchema,
  primary_site_id: uuidSchema.nullable().default(null),
  time_zone: timeZoneSchema.default('Asia/Bangkok'),
});

export const terminateEmploymentSchema = z.object({
  terminated_on: isoDateSchema,
  reason: z.string().trim().min(1).max(500),
});

export const employmentSchema = z
  .object({
    id: uuidSchema,
    company_id: uuidSchema,
    person_id: uuidSchema,
    employee_code: z.string(),
    /**
     * ชื่อที่ใช้แสดงผล มาจากตาราง people
     *
     * ใส่มากับ employment เลยเพราะทุกหน้าจอที่แสดงพนักงานต้องใช้ชื่อ ถ้าไม่ส่งมา
     * ฝั่ง client ต้องยิงหา /people ต่ออีกรอบต่อหนึ่งแถว หรือไม่ก็แสดง UUID ให้ผู้ใช้ดู
     */
    display_name: z.string(),
    full_name: z.string(),
    employment_type: employmentTypeSchema,
    hired_on: isoDateSchema,
    terminated_on: isoDateSchema.nullable(),
    status: employmentStatusSchema,
    primary_site_id: uuidSchema.nullable(),
    time_zone: z.string(),
  })
  .merge(auditFieldsSchema);

export const listEmploymentsQuerySchema = cursorPaginationSchema.extend({
  company_id: uuidSchema.optional(),
  status: employmentStatusSchema.optional(),
  person_id: uuidSchema.optional(),
  /** ค่าเริ่มต้นคือ "วันนี้" — ทุก query ที่อิงช่วงเวลาต้องระบุ as-of ได้ (ADR-0012) */
  as_of: isoDateSchema.optional(),
});

// ---------------------------------------------------------------------------
// Employment assignment — effective-dated
// ---------------------------------------------------------------------------

export const createAssignmentSchema = z.object({
  org_unit_id: uuidSchema.nullable().default(null),
  position_id: uuidSchema.nullable().default(null),
  manager_employment_id: uuidSchema.nullable().default(null),
  site_id: uuidSchema.nullable().default(null),
  effective_from: isoDateSchema,
  effective_to: isoDateSchema.nullable().default(null),
  /**
   * true = ปิดช่วงที่เปิดอยู่ให้จบก่อน effective_from แล้วเปิดช่วงใหม่
   * false = ปฏิเสธถ้าทับซ้อน (ค่าเริ่มต้น — ไม่แก้ข้อมูลเดิมโดยที่ผู้เรียกไม่ได้สั่ง)
   */
  supersede_current: z.boolean().default(false),
});

export const assignmentSchema = z
  .object({
    id: uuidSchema,
    employment_id: uuidSchema,
    org_unit_id: uuidSchema.nullable(),
    position_id: uuidSchema.nullable(),
    manager_employment_id: uuidSchema.nullable(),
    site_id: uuidSchema.nullable(),
    effective_from: isoDateSchema,
    effective_to: isoDateSchema.nullable(),
  })
  .merge(auditFieldsSchema);

// ---------------------------------------------------------------------------
// Compensation — effective-dated (spec §3.3 P9)
// ---------------------------------------------------------------------------

export const payBasisSchema = z.enum(['MONTHLY', 'DAILY', 'HOURLY']);

export const createCompensationSchema = z.object({
  employment_id: uuidSchema,
  pay_basis: payBasisSchema,
  amount: moneySchema,
  currency: currencySchema.default('THB'),
  effective_from: isoDateSchema,
  effective_to: isoDateSchema.nullable().default(null),
  approval_reference: z.string().trim().max(120).nullable().default(null),
  note: z.string().trim().max(500).default(''),
  supersede_current: z.boolean().default(false),
});

export const compensationSchema = z
  .object({
    id: uuidSchema,
    employment_id: uuidSchema,
    pay_basis: payBasisSchema,
    amount: moneySchema,
    currency: z.string(),
    effective_from: isoDateSchema,
    effective_to: isoDateSchema.nullable(),
    provenance: z.enum(['MANUAL', 'LEGACY_IMPORT', 'BULK_IMPORT']),
    approval_reference: z.string().nullable(),
    note: z.string(),
  })
  .merge(auditFieldsSchema);

export const listCompensationQuerySchema = cursorPaginationSchema.extend({
  employment_id: uuidSchema,
  as_of: isoDateSchema.optional(),
});

export type CreatePersonInput = z.infer<typeof createPersonSchema>;
export type Person = z.infer<typeof personSchema>;
export type CreateEmploymentInput = z.infer<typeof createEmploymentSchema>;
export type Employment = z.infer<typeof employmentSchema>;
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
export type Assignment = z.infer<typeof assignmentSchema>;
export type CreateCompensationInput = z.infer<typeof createCompensationSchema>;
export type Compensation = z.infer<typeof compensationSchema>;
