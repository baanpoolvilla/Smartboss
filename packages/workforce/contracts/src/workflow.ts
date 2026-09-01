import { z } from 'zod';
import { isoDateSchema, isoDateTimeSchema, uuidSchema } from './common';

export const createLeaveTypeSchema = z.object({
  company_id: uuidSchema,
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
  paid: z.boolean().default(true),
  unit: z.enum(['DAY', 'HALF_DAY', 'HOUR']).default('DAY'),
  /**
   * โควตาเก็บเป็นนาที ไม่ใช่วัน — ระบบเดิมเก็บเป็นวันจึงรองรับลาครึ่งวันหรือ
   * รายชั่วโมงไม่ได้ (spec §3.3 P7)
   */
  quota_minutes_per_year: z.number().int().min(0).max(525_600).default(0),
  advance_notice_days: z.number().int().min(0).max(365).default(0),
  /** true = อนุมัติทันทีตอนส่ง (สิทธิ์ ไม่ใช่คำขอ) */
  auto_approve: z.boolean().default(false),
  /** 0 = ไม่จำกัดรายเดือน — quota_minutes_per_year เป็นรายปี คุมรายเดือนไม่ได้ */
  monthly_quota_days: z.number().int().min(0).max(31).default(0),
  attachment_required: z.boolean().default(false),
  allow_negative: z.boolean().default(false),
  effective_from: isoDateSchema,
});

export const grantLeaveBalanceSchema = z.object({
  employment_id: uuidSchema,
  leave_type_id: uuidSchema,
  period_year: z.number().int().min(2000).max(2200),
  minutes: z.number().int().min(0).max(525_600),
  reason: z.string().trim().min(1).max(500),
});

export const submitLeaveSchema = z.object({
  employment_id: uuidSchema,
  leave_type_id: uuidSchema,
  starts_on: isoDateSchema,
  ends_on: isoDateSchema,
  total_minutes: z.number().int().min(1).max(525_600),
  half_day_start: z.boolean().default(false),
  half_day_end: z.boolean().default(false),
  reason: z.string().trim().max(500).default(''),
  /**
   * มีค่า = นี่คือคำขอ "สลับวันหยุด" จากวันนี้มาเป็นวันที่ขอใหม่
   * บังคับ SUBMITTED เสมอแม้ประเภทการลาจะ auto_approve (ดู leave.service)
   */
  swap_from_date: isoDateSchema.optional(),
});

export const decideLeaveSchema = z.object({
  outcome: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().trim().min(1).max(500),
});

export const cancelLeaveSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const leaveBalanceSchema = z.object({
  leave_type_id: uuidSchema,
  period_year: z.number().int(),
  granted_minutes: z.number().int(),
  reserved_minutes: z.number().int(),
  consumed_minutes: z.number().int(),
  available_minutes: z.number().int(),
});

export const submitOvertimeSchema = z.object({
  employment_id: uuidSchema,
  work_date: isoDateSchema,
  ot_category: z.enum(['WORKDAY', 'REST_DAY', 'PUBLIC_HOLIDAY']).default('WORKDAY'),
  planned_minutes: z.number().int().min(0).max(1440),
  reason: z.string().trim().max(500).default(''),
});

export const preApproveOvertimeSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const finalApproveOvertimeSchema = z.object({
  actual_minutes: z.number().int().min(0).max(1440),
  /** null = ใช้ค่า eligible ที่ policy คำนวณให้ */
  approved_minutes: z.number().int().min(0).max(1440).nullable().default(null),
  reason: z.string().trim().min(1).max(500),
});

export const overtimeRequestSchema = z.object({
  id: uuidSchema,
  employment_id: uuidSchema,
  work_date: isoDateSchema,
  ot_category: z.string(),
  planned_minutes: z.number().int(),
  actual_minutes: z.number().int(),
  eligible_minutes: z.number().int(),
  approved_minutes: z.number().int(),
  status: z.string(),
});

export const createTimesheetPeriodSchema = z.object({
  company_id: uuidSchema,
  name: z.string().trim().min(1).max(120),
  starts_on: isoDateSchema,
  ends_on: isoDateSchema,
});

export const closeTimesheetPeriodSchema = z.object({
  /** ปิดทั้งที่ยังมี exception ค้าง — ต้องมีเหตุผลเสมอ (spec §10.2) */
  force: z.boolean().default(false),
  reason: z.string().trim().max(500).default(''),
});

export const reopenTimesheetPeriodSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const timesheetSchema = z.object({
  id: uuidSchema,
  employment_id: uuidSchema,
  status: z.enum(['DRAFT', 'MANAGER_APPROVED', 'HR_APPROVED', 'CLOSED']),
  scheduled_days: z.number().int(),
  worked_days: z.number().int(),
  worked_minutes: z.number().int(),
  paid_minutes: z.number().int(),
  late_minutes: z.number().int(),
  absence_minutes: z.number().int(),
  early_out_minutes: z.number().int(),
  paid_leave_minutes: z.number().int(),
  unpaid_leave_minutes: z.number().int(),
  ot_workday_minutes: z.number().int(),
  ot_rest_day_minutes: z.number().int(),
  ot_holiday_minutes: z.number().int(),
  blocking_exception_count: z.number().int(),
});

export const timesheetPeriodSchema = z.object({
  id: uuidSchema,
  company_id: uuidSchema,
  name: z.string(),
  starts_on: isoDateSchema,
  ends_on: isoDateSchema,
  status: z.enum(['OPEN', 'REVIEW', 'CLOSED', 'REOPENED']),
  closed_at: isoDateTimeSchema.nullable(),
});

export type SubmitLeaveInput = z.infer<typeof submitLeaveSchema>;
export type SubmitOvertimeInput = z.infer<typeof submitOvertimeSchema>;
