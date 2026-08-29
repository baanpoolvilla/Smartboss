import { boolean, date, index, integer, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, workforce } from './base';

export const leaveTypes = workforce.table('leave_types', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  paid: boolean('paid').notNull().default(true),
  unit: text('unit').notNull().default('DAY'),
  quotaMinutesPerYear: integer('quota_minutes_per_year').notNull().default(0),
  accrualMethod: text('accrual_method').notNull().default('ANNUAL_GRANT'),
  proRateFirstYear: boolean('pro_rate_first_year').notNull().default(true),
  carryOverMaxMinutes: integer('carry_over_max_minutes').notNull().default(0),
  carryOverExpiryMonths: integer('carry_over_expiry_months').notNull().default(0),
  advanceNoticeDays: integer('advance_notice_days').notNull().default(0),
  /** true = อนุมัติทันทีตอนส่ง — ใช้กับสิทธิ์ที่ไม่ใช่คำขอ เช่นวันหยุดประจำเดือน */
  autoApprove: boolean('auto_approve').notNull().default(false),
  /** 0 = ไม่จำกัดรายเดือน · quota_minutes_per_year คุมรายเดือนไม่ได้ */
  monthlyQuotaDays: integer('monthly_quota_days').notNull().default(0),
  attachmentRequired: boolean('attachment_required').notNull().default(false),
  minDurationMinutes: integer('min_duration_minutes').notNull().default(0),
  maxDurationMinutes: integer('max_duration_minutes'),
  allowNegative: boolean('allow_negative').notNull().default(false),
  approvalLevels: integer('approval_levels').notNull().default(1),
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),
  ...auditColumns,
});

export const leaveBalanceLedger = workforce.table(
  'leave_balance_ledger',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    leaveTypeId: uuid('leave_type_id').notNull(),
    entryType: text('entry_type').notNull(),
    minutes: integer('minutes').notNull(),
    effectiveOn: date('effective_on').notNull(),
    periodYear: integer('period_year').notNull(),
    leaveRequestId: uuid('leave_request_id'),
    reason: text('reason').notNull().default(''),
    reversalOfId: uuid('reversal_of_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => [
    index('leave_balance_ledger_balance_idx').on(
      table.tenantId,
      table.employmentId,
      table.leaveTypeId,
      table.periodYear,
    ),
  ],
);

export const leaveRequests = workforce.table(
  'leave_requests',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    leaveTypeId: uuid('leave_type_id').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    totalMinutes: integer('total_minutes').notNull(),
    paidMinutes: integer('paid_minutes').notNull().default(0),
    unpaidMinutes: integer('unpaid_minutes').notNull().default(0),
    halfDayStart: boolean('half_day_start').notNull().default(false),
    halfDayEnd: boolean('half_day_end').notNull().default(false),
    reason: text('reason').notNull().default(''),
    attachmentObjectId: uuid('attachment_object_id'),
    status: text('status').notNull().default('DRAFT'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by'),
    decisionReason: text('decision_reason'),
    ...auditColumns,
  },
  (table) => [
    index('leave_requests_employment_idx').on(table.tenantId, table.employmentId, table.startsOn),
  ],
);

export const overtimeRequests = workforce.table(
  'overtime_requests',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    workDate: date('work_date').notNull(),
    otCategory: text('ot_category').notNull().default('WORKDAY'),
    plannedMinutes: integer('planned_minutes').notNull().default(0),
    actualMinutes: integer('actual_minutes').notNull().default(0),
    eligibleMinutes: integer('eligible_minutes').notNull().default(0),
    approvedMinutes: integer('approved_minutes').notNull().default(0),
    reason: text('reason').notNull().default(''),
    status: text('status').notNull().default('DRAFT'),
    preApprovedBy: uuid('pre_approved_by'),
    preApprovedAt: timestamp('pre_approved_at', { withTimezone: true }),
    finalApprovedBy: uuid('final_approved_by'),
    finalApprovedAt: timestamp('final_approved_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    ...auditColumns,
  },
  (table) => [
    index('overtime_requests_pending_idx').on(table.tenantId, table.companyId, table.status),
  ],
);

export const approvalRequests = workforce.table(
  'approval_requests',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    subjectVersion: integer('subject_version').notNull().default(1),
    status: text('status').notNull().default('PENDING'),
    requestedBy: uuid('requested_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('approval_requests_subject_idx').on(table.tenantId, table.subjectType, table.subjectId),
  ],
);

export const approvalSteps = workforce.table(
  'approval_steps',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    requestId: uuid('request_id').notNull(),
    stepOrder: integer('step_order').notNull(),
    requiredPermission: text('required_permission').notNull(),
    status: text('status').notNull().default('PENDING'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('approval_steps_order_key').on(table.requestId, table.stepOrder)],
);

export const approvalActions = workforce.table('approval_actions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  stepId: uuid('step_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  action: text('action').notNull(),
  reason: text('reason').notNull().default(''),
  actedAt: timestamp('acted_at', { withTimezone: true }).notNull().defaultNow(),
});

export const timesheetPeriods = workforce.table(
  'timesheet_periods',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    name: text('name').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    cutoffAt: timestamp('cutoff_at', { withTimezone: true }),
    status: text('status').notNull().default('OPEN'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by'),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    reopenedBy: uuid('reopened_by'),
    reopenReason: text('reopen_reason'),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex('timesheet_periods_range_key').on(
      table.tenantId,
      table.companyId,
      table.startsOn,
      table.endsOn,
    ),
  ],
);

export const timesheets = workforce.table(
  'timesheets',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    periodId: uuid('period_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    status: text('status').notNull().default('DRAFT'),
    scheduledDays: integer('scheduled_days').notNull().default(0),
    workedDays: integer('worked_days').notNull().default(0),
    workedMinutes: integer('worked_minutes').notNull().default(0),
    paidMinutes: integer('paid_minutes').notNull().default(0),
    lateMinutes: integer('late_minutes').notNull().default(0),
    absenceMinutes: integer('absence_minutes').notNull().default(0),
    earlyOutMinutes: integer('early_out_minutes').notNull().default(0),
    paidLeaveMinutes: integer('paid_leave_minutes').notNull().default(0),
    unpaidLeaveMinutes: integer('unpaid_leave_minutes').notNull().default(0),
    otWorkdayMinutes: integer('ot_workday_minutes').notNull().default(0),
    otRestDayMinutes: integer('ot_rest_day_minutes').notNull().default(0),
    otHolidayMinutes: integer('ot_holiday_minutes').notNull().default(0),
    holidayDays: integer('holiday_days').notNull().default(0),
    blockingExceptionCount: integer('blocking_exception_count').notNull().default(0),
    managerApprovedBy: uuid('manager_approved_by'),
    managerApprovedAt: timestamp('manager_approved_at', { withTimezone: true }),
    hrApprovedBy: uuid('hr_approved_by'),
    hrApprovedAt: timestamp('hr_approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('timesheets_period_employment_key').on(table.periodId, table.employmentId),
  ],
);

export const timesheetDaySnapshots = workforce.table(
  'timesheet_day_snapshots',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    timesheetId: uuid('timesheet_id').notNull(),
    workDate: date('work_date').notNull(),
    attendanceResultId: uuid('attendance_result_id'),
    resultVersion: integer('result_version').notNull().default(1),
    workedMinutes: integer('worked_minutes').notNull().default(0),
    paidMinutes: integer('paid_minutes').notNull().default(0),
    lateMinutes: integer('late_minutes').notNull().default(0),
    absenceMinutes: integer('absence_minutes').notNull().default(0),
    earlyOutMinutes: integer('early_out_minutes').notNull().default(0),
    paidLeaveMinutes: integer('paid_leave_minutes').notNull().default(0),
    unpaidLeaveMinutes: integer('unpaid_leave_minutes').notNull().default(0),
    otMinutes: integer('ot_minutes').notNull().default(0),
    otCategory: text('ot_category'),
    isRestDay: boolean('is_rest_day').notNull().default(false),
    isHoliday: boolean('is_holiday').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('timesheet_day_snapshots_key').on(table.timesheetId, table.workDate)],
);

export const workflowTables = {
  leaveTypes,
  leaveBalanceLedger,
  leaveRequests,
  overtimeRequests,
  approvalRequests,
  approvalSteps,
  approvalActions,
  timesheetPeriods,
  timesheets,
  timesheetDaySnapshots,
};
