import { z } from 'zod';
import { cursorPaginationSchema, isoDateSchema, isoDateTimeSchema, uuidSchema } from './common';
import { eventIntentSchema } from './ingestion';

const timeOfDaySchema = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');

// ---------------------------------------------------------------------------
// Work policy (spec §7.2)
// ---------------------------------------------------------------------------

export const createWorkPolicySchema = z
  .object({
    company_id: uuidSchema,
    code: z.string().trim().min(1).max(32),
    name: z.string().trim().min(1).max(120),
    late_mode: z.enum(['STRICT', 'GRACE', 'FLEX']),
    grace_minutes: z.number().int().min(0).max(240).default(0),
    /** เกิน grace แล้วหักทั้งช่วงหรือเฉพาะส่วนเกิน — ต่างกันเป็นเงินจริง */
    grace_deduction: z.enum(['FULL_FROM_SCHEDULED', 'EXCESS_OVER_GRACE']).default('EXCESS_OVER_GRACE'),
    flex_start: timeOfDaySchema.default('07:00'),
    flex_end: timeOfDaySchema.default('10:00'),
    flex_required_work_minutes: z.number().int().min(1).max(1440).default(480),
    early_out_tolerance_minutes: z.number().int().min(0).max(240).default(0),
    duplicate_punch_window_minutes: z.number().int().min(0).max(120).default(3),
    max_shift_minutes: z.number().int().min(60).max(1440).default(960),
    excessive_work_minutes: z.number().int().min(60).max(1440).default(840),
    ot_requires_approval: z.boolean().default(true),
    ot_minimum_minutes: z.number().int().min(0).max(480).default(30),
    ot_rounding_minutes: z.number().int().min(0).max(120).default(0),
    effective_from: isoDateSchema,
    effective_to: isoDateSchema.nullable().default(null),
  })
  .refine((value) => value.late_mode !== 'GRACE' || value.grace_minutes > 0, {
    message: 'GRACE mode requires grace_minutes greater than zero',
    path: ['grace_minutes'],
  });

// ---------------------------------------------------------------------------
// Shift
// ---------------------------------------------------------------------------

export const shiftBreakSchema = z.object({
  start: timeOfDaySchema,
  duration_minutes: z.number().int().min(1).max(480),
  paid: z.boolean().default(false),
  auto_deduct: z.boolean().default(true),
});

export const createShiftSchema = z.object({
  company_id: uuidSchema,
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
  start: timeOfDaySchema,
  end: timeOfDaySchema,
  /** true = กะข้ามคืน; end ตีความเป็นเวลาของวันถัดไป (spec §7.1) */
  crosses_midnight: z.boolean().default(false),
  rest_day: z.boolean().default(false),
  work_policy_id: uuidSchema.nullable().default(null),
  site_id: uuidSchema.nullable().default(null),
  breaks: z.array(shiftBreakSchema).max(10).default([]),
});

export const shiftSchema = z.object({
  id: uuidSchema,
  company_id: uuidSchema,
  code: z.string(),
  name: z.string(),
  start_minutes: z.number().int(),
  end_minutes: z.number().int(),
  rest_day: z.boolean(),
  status: z.string(),
});

// ---------------------------------------------------------------------------
// Recurring pattern and roster
// ---------------------------------------------------------------------------

export const setRecurringPatternSchema = z.object({
  employment_id: uuidSchema,
  monday_shift_id: uuidSchema.nullable().default(null),
  tuesday_shift_id: uuidSchema.nullable().default(null),
  wednesday_shift_id: uuidSchema.nullable().default(null),
  thursday_shift_id: uuidSchema.nullable().default(null),
  friday_shift_id: uuidSchema.nullable().default(null),
  saturday_shift_id: uuidSchema.nullable().default(null),
  sunday_shift_id: uuidSchema.nullable().default(null),
  effective_from: isoDateSchema,
  effective_to: isoDateSchema.nullable().default(null),
  supersede_current: z.boolean().default(false),
});

export const createRosterPeriodSchema = z.object({
  company_id: uuidSchema,
  name: z.string().trim().min(1).max(120),
  starts_on: isoDateSchema,
  ends_on: isoDateSchema,
});

export const bulkUpsertAssignmentsSchema = z.object({
  assignments: z
    .array(
      z.object({
        employment_id: uuidSchema,
        work_date: isoDateSchema,
        shift_id: uuidSchema.nullable(),
        note: z.string().trim().max(200).default(''),
      }),
    )
    .min(1)
    .max(1000),
});

export const rosterPeriodSchema = z.object({
  id: uuidSchema,
  company_id: uuidSchema,
  name: z.string(),
  starts_on: isoDateSchema,
  ends_on: isoDateSchema,
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  published_at: isoDateTimeSchema.nullable(),
});

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

export const createHolidayCalendarSchema = z.object({
  company_id: uuidSchema,
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
});

export const addHolidayDatesSchema = z.object({
  dates: z
    .array(
      z.object({
        holiday_date: isoDateSchema,
        name: z.string().trim().min(1).max(120),
        paid: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(100),
});

// ---------------------------------------------------------------------------
// Attendance results, exceptions and corrections
// ---------------------------------------------------------------------------

export const recalculateSchema = z.object({
  employment_id: uuidSchema,
  from: isoDateSchema,
  to: isoDateSchema,
});

export const listAttendanceResultsQuerySchema = z.object({
  employment_id: uuidSchema.optional(),
  company_id: uuidSchema.optional(),
  from: isoDateSchema,
  to: isoDateSchema,
});

export const listExceptionsQuerySchema = cursorPaginationSchema.extend({
  company_id: uuidSchema.optional(),
  employment_id: uuidSchema.optional(),
  status: z.enum(['OPEN', 'RESOLVED', 'WAIVED']).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

export const resolveExceptionSchema = z.object({
  outcome: z.enum(['RESOLVED', 'WAIVED']),
  reason: z.string().trim().min(1).max(500),
});

export const createAdjustmentSchema = z.object({
  employment_id: uuidSchema,
  work_date: isoDateSchema,
  adjustment_type: z.enum(['ADD_PUNCH', 'IGNORE_EVENT', 'CHANGE_INTENT']),
  target_event_id: uuidSchema.nullable().default(null),
  punch_at: isoDateTimeSchema.nullable().default(null),
  event_intent: eventIntentSchema.nullable().default(null),
  reason: z.string().trim().min(1).max(500),
  comment: z.string().trim().max(1000).default(''),
});

export const approveAdjustmentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const attendanceResultSchema = z.object({
  id: uuidSchema,
  employment_id: uuidSchema,
  work_date: isoDateSchema,
  result_version: z.number().int(),
  late_minutes: z.number().int(),
  absence_minutes: z.number().int(),
  early_out_minutes: z.number().int(),
  worked_minutes: z.number().int(),
  paid_minutes: z.number().int(),
  break_minutes: z.number().int(),
  ot_candidate_minutes: z.number().int(),
  is_rest_day: z.boolean(),
  is_holiday: z.boolean(),
  is_on_leave: z.boolean(),
  has_blocking_exception: z.boolean(),
});

export const attendanceExceptionSchema = z.object({
  id: uuidSchema,
  employment_id: uuidSchema,
  work_date: isoDateSchema,
  code: z.string(),
  blocking: z.boolean(),
  detail: z.string(),
  status: z.enum(['OPEN', 'RESOLVED', 'WAIVED']),
  resolution_reason: z.string().nullable(),
});

export type CreateWorkPolicyInput = z.infer<typeof createWorkPolicySchema>;
export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type SetRecurringPatternInput = z.infer<typeof setRecurringPatternSchema>;
export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;
