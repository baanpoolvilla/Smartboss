import { boolean, date, index, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, bytea, workforce } from './base';

export const workPolicies = workforce.table(
  'work_policies',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    lateMode: text('late_mode').notNull().default('GRACE'),
    graceMinutes: integer('grace_minutes').notNull().default(0),
    graceDeduction: text('grace_deduction').notNull().default('EXCESS_OVER_GRACE'),
    flexStartMinutes: integer('flex_start_minutes').notNull().default(420),
    flexEndMinutes: integer('flex_end_minutes').notNull().default(600),
    flexRequiredWorkMinutes: integer('flex_required_work_minutes').notNull().default(480),
    earlyOutToleranceMinutes: integer('early_out_tolerance_minutes').notNull().default(0),
    duplicatePunchWindowMinutes: integer('duplicate_punch_window_minutes').notNull().default(3),
    maxShiftMinutes: integer('max_shift_minutes').notNull().default(960),
    excessiveWorkMinutes: integer('excessive_work_minutes').notNull().default(840),
    otRequiresApproval: boolean('ot_requires_approval').notNull().default(true),
    otMinimumMinutes: integer('ot_minimum_minutes').notNull().default(30),
    otRoundingMinutes: integer('ot_rounding_minutes').notNull().default(0),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    ...auditColumns,
  },
  (table) => [
    index('work_policies_lookup_idx').on(table.tenantId, table.companyId, table.effectiveFrom),
  ],
);

export const shiftDefinitions = workforce.table('shift_definitions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  startMinutes: integer('start_minutes').notNull(),
  endMinutes: integer('end_minutes').notNull(),
  restDay: boolean('rest_day').notNull().default(false),
  workPolicyId: uuid('work_policy_id'),
  siteId: uuid('site_id'),
  allowedMethods: text('allowed_methods').array().notNull(),
  status: text('status').notNull().default('ACTIVE'),
  ...auditColumns,
});

export const shiftBreakRules = workforce.table(
  'shift_break_rules',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    shiftId: uuid('shift_id').notNull(),
    startMinutes: integer('start_minutes').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    paid: boolean('paid').notNull().default(false),
    autoDeduct: boolean('auto_deduct').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('shift_break_rules_shift_idx').on(table.tenantId, table.shiftId)],
);

export const recurringWorkPatterns = workforce.table(
  'recurring_work_patterns',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    mondayShiftId: uuid('monday_shift_id'),
    tuesdayShiftId: uuid('tuesday_shift_id'),
    wednesdayShiftId: uuid('wednesday_shift_id'),
    thursdayShiftId: uuid('thursday_shift_id'),
    fridayShiftId: uuid('friday_shift_id'),
    saturdayShiftId: uuid('saturday_shift_id'),
    sundayShiftId: uuid('sunday_shift_id'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    ...auditColumns,
  },
  (table) => [
    index('recurring_work_patterns_lookup_idx').on(
      table.tenantId,
      table.employmentId,
      table.effectiveFrom,
    ),
  ],
);

export const rosterPeriods = workforce.table(
  'roster_periods',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    name: text('name').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    status: text('status').notNull().default('DRAFT'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by'),
    ...auditColumns,
  },
  (table) => [index('roster_periods_company_idx').on(table.tenantId, table.companyId, table.startsOn)],
);

export const shiftAssignments = workforce.table(
  'shift_assignments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    rosterPeriodId: uuid('roster_period_id'),
    employmentId: uuid('employment_id').notNull(),
    workDate: date('work_date').notNull(),
    shiftId: uuid('shift_id'),
    status: text('status').notNull().default('DRAFT'),
    note: text('note').notNull().default(''),
    ...auditColumns,
  },
  (table) => [index('shift_assignments_date_idx').on(table.tenantId, table.workDate, table.status)],
);

export const holidayCalendars = workforce.table('holiday_calendars', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  ...auditColumns,
});

export const holidayDates = workforce.table('holiday_dates', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  calendarId: uuid('calendar_id').notNull(),
  holidayDate: date('holiday_date').notNull(),
  name: text('name').notNull(),
  paid: boolean('paid').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
});

export const timeEventAdjustments = workforce.table(
  'time_event_adjustments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    workDate: date('work_date').notNull(),
    adjustmentType: text('adjustment_type').notNull(),
    targetEventId: uuid('target_event_id'),
    punchAt: timestamp('punch_at', { withTimezone: true }),
    eventIntent: text('event_intent'),
    reason: text('reason').notNull(),
    comment: text('comment').notNull().default(''),
    status: text('status').notNull().default('PENDING'),
    requestedBy: uuid('requested_by'),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    postCutoff: boolean('post_cutoff').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('time_event_adjustments_lookup_idx').on(
      table.tenantId,
      table.employmentId,
      table.workDate,
    ),
  ],
);

export const attendanceResults = workforce.table(
  'attendance_results',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    workDate: date('work_date').notNull(),
    resultVersion: integer('result_version').notNull().default(1),
    isCurrent: boolean('is_current').notNull().default(true),
    shiftId: uuid('shift_id'),
    workPolicyId: uuid('work_policy_id'),
    scheduledInAt: timestamp('scheduled_in_at', { withTimezone: true }),
    scheduledOutAt: timestamp('scheduled_out_at', { withTimezone: true }),
    actualInAt: timestamp('actual_in_at', { withTimezone: true }),
    actualOutAt: timestamp('actual_out_at', { withTimezone: true }),
    lateMinutes: integer('late_minutes').notNull().default(0),
    absenceMinutes: integer('absence_minutes').notNull().default(0),
    earlyOutMinutes: integer('early_out_minutes').notNull().default(0),
    workedMinutes: integer('worked_minutes').notNull().default(0),
    paidMinutes: integer('paid_minutes').notNull().default(0),
    breakMinutes: integer('break_minutes').notNull().default(0),
    unpaidBreakMinutes: integer('unpaid_break_minutes').notNull().default(0),
    otCandidateMinutes: integer('ot_candidate_minutes').notNull().default(0),
    isRestDay: boolean('is_rest_day').notNull().default(false),
    isHoliday: boolean('is_holiday').notNull().default(false),
    isOnLeave: boolean('is_on_leave').notNull().default(false),
    hasBlockingException: boolean('has_blocking_exception').notNull().default(false),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull().defaultNow(),
    calculationReason: text('calculation_reason').notNull().default('INITIAL'),
    inputDigest: bytea('input_digest').notNull(),
  },
  (table) => [
    index('attendance_results_lookup_idx').on(
      table.tenantId,
      table.employmentId,
      table.workDate,
      table.resultVersion,
    ),
    index('attendance_results_company_date_idx').on(
      table.tenantId,
      table.companyId,
      table.workDate,
    ),
  ],
);

export const attendanceResultPunches = workforce.table(
  'attendance_result_punches',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    resultId: uuid('result_id').notNull(),
    sequence: integer('sequence').notNull(),
    inEventId: uuid('in_event_id'),
    outEventId: uuid('out_event_id'),
    inAdjustmentId: uuid('in_adjustment_id'),
    outAdjustmentId: uuid('out_adjustment_id'),
    inAt: timestamp('in_at', { withTimezone: true }),
    outAt: timestamp('out_at', { withTimezone: true }),
    minutes: integer('minutes').notNull().default(0),
  },
  (table) => [index('attendance_result_punches_result_idx').on(table.tenantId, table.resultId)],
);

export const attendanceExceptions = workforce.table(
  'attendance_exceptions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    resultId: uuid('result_id'),
    workDate: date('work_date').notNull(),
    code: text('code').notNull(),
    blocking: boolean('blocking').notNull().default(false),
    detail: text('detail').notNull().default(''),
    rawEventId: uuid('raw_event_id'),
    status: text('status').notNull().default('OPEN'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by'),
    resolutionReason: text('resolution_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('attendance_exceptions_employment_idx').on(
      table.tenantId,
      table.employmentId,
      table.workDate,
    ),
  ],
);

export const attendanceTables = {
  workPolicies,
  shiftDefinitions,
  shiftBreakRules,
  recurringWorkPatterns,
  rosterPeriods,
  shiftAssignments,
  holidayCalendars,
  holidayDates,
  timeEventAdjustments,
  attendanceResults,
  attendanceResultPunches,
  attendanceExceptions,
};
