import { boolean, date, index, integer, jsonb, numeric, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, bytea, workforce } from './base';

export const payItemDefinitions = workforce.table(
  'pay_item_definitions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    calculationType: text('calculation_type').notNull(),
    affectsNetPay: boolean('affects_net_pay').notNull().default(true),
    taxable: boolean('taxable').notNull().default(false),
    socialSecurityBase: boolean('social_security_base').notNull().default(false),
    providentFundBase: boolean('provident_fund_base').notNull().default(false),
    employerOnly: boolean('employer_only').notNull().default(false),
    roundingDecimals: integer('rounding_decimals').notNull().default(2),
    roundingMode: text('rounding_mode').notNull().default('HALF_UP'),
    displayOrder: integer('display_order').notNull().default(100),
    glAccount: text('gl_account'),
    status: text('status').notNull().default('DRAFT'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    ...auditColumns,
  },
  (table) => [
    index('pay_item_definitions_lookup_idx').on(table.tenantId, table.companyId, table.effectiveFrom),
  ],
);

export const payItemFormulas = workforce.table(
  'pay_item_formulas',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    payItemId: uuid('pay_item_id').notNull(),
    formulaVersion: integer('formula_version').notNull().default(1),
    // AST เป็น jsonb — ไม่ใช่สตริงที่ต้อง eval (spec §21)
    ast: jsonb('ast').notNull(),
    referencedVariables: text('referenced_variables').array().notNull(),
    referencedItems: text('referenced_items').array().notNull(),
    status: text('status').notNull().default('DRAFT'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => [uniqueIndex('pay_item_formulas_version_key').on(table.payItemId, table.formulaVersion)],
);

export const statutoryRuleSets = workforce.table(
  'statutory_rule_sets',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    jurisdiction: text('jurisdiction').notNull().default('TH'),
    ruleType: text('rule_type').notNull(),
    version: text('version').notNull(),
    status: text('status').notNull().default('DRAFT'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    parameters: jsonb('parameters').notNull().default({}),
    formulas: jsonb('formulas').notNull().default({}),
    sourceReference: text('source_reference').notNull().default(''),
    approvedBy: text('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    goldenTestsPassed: boolean('golden_tests_passed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
    versionNo: integer('version_no').notNull().default(1),
  },
  (table) => [
    index('statutory_rule_sets_effective_idx').on(
      table.tenantId,
      table.ruleType,
      table.status,
      table.effectiveFrom,
    ),
  ],
);

export const payrollTemplates = workforce.table('payroll_templates', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('DRAFT'),
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),
  ...auditColumns,
});

export const payrollTemplateItems = workforce.table(
  'payroll_template_items',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    templateId: uuid('template_id').notNull(),
    payItemId: uuid('pay_item_id').notNull(),
    defaultAmount: numeric('default_amount', { precision: 19, scale: 4 }),
    defaultRate: numeric('default_rate', { precision: 9, scale: 6 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('payroll_template_items_key').on(table.templateId, table.payItemId)],
);

export const employmentPayItems = workforce.table(
  'employment_pay_items',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    payItemId: uuid('pay_item_id').notNull(),
    amount: numeric('amount', { precision: 19, scale: 4 }),
    rate: numeric('rate', { precision: 9, scale: 6 }),
    enabled: boolean('enabled').notNull().default(true),
    approvalReference: text('approval_reference'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    ...auditColumns,
  },
  (table) => [
    index('employment_pay_items_lookup_idx').on(
      table.tenantId,
      table.employmentId,
      table.effectiveFrom,
    ),
  ],
);

export const payrollPeriods = workforce.table(
  'payroll_periods',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    name: text('name').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    payDate: date('pay_date').notNull(),
    periodYear: integer('period_year').notNull(),
    periodSequence: integer('period_sequence').notNull(),
    status: text('status').notNull().default('OPEN'),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex('payroll_periods_sequence_key').on(
      table.tenantId,
      table.companyId,
      table.periodYear,
      table.periodSequence,
    ),
  ],
);

export const payrollRuns = workforce.table(
  'payroll_runs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    periodId: uuid('period_id').notNull(),
    runType: text('run_type').notNull().default('REGULAR'),
    status: text('status').notNull().default('DRAFT'),
    timesheetPeriodId: uuid('timesheet_period_id'),
    parentRunId: uuid('parent_run_id'),
    snapshotId: uuid('snapshot_id'),
    lockChecksum: bytea('lock_checksum'),
    waivedValidations: text('waived_validations').array().notNull(),
    preparedBy: uuid('prepared_by'),
    submittedBy: uuid('submitted_by'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    lockedBy: uuid('locked_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    ...auditColumns,
  },
  (table) => [index('payroll_runs_company_idx').on(table.tenantId, table.companyId, table.status)],
);

export const payrollInputSnapshots = workforce.table(
  'payroll_input_snapshots',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    runId: uuid('run_id').notNull(),
    builtAt: timestamp('built_at', { withTimezone: true }).notNull().defaultNow(),
    builtBy: uuid('built_by'),
    contentHash: bytea('content_hash').notNull(),
    employmentCount: integer('employment_count').notNull().default(0),
    ruleSetIds: uuid('rule_set_ids').array().notNull(),
    payItemIds: uuid('pay_item_ids').array().notNull(),
  },
  (table) => [uniqueIndex('payroll_input_snapshots_run_key').on(table.runId)],
);

export const payrollSnapshotEmployments = workforce.table(
  'payroll_snapshot_employments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    snapshotId: uuid('snapshot_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    employeeCode: text('employee_code').notNull(),
    employmentType: text('employment_type').notNull(),
    hiredOn: date('hired_on').notNull(),
    terminatedOn: date('terminated_on'),
    currency: text('currency').notNull().default('THB'),
    moneyVariables: jsonb('money_variables').notNull().default({}),
    quantityVariables: jsonb('quantity_variables').notNull().default({}),
    manualAmounts: jsonb('manual_amounts').notNull().default({}),
    timesheetId: uuid('timesheet_id'),
  },
  (table) => [
    uniqueIndex('payroll_snapshot_employments_key').on(table.snapshotId, table.employmentId),
  ],
);

export const payrollEmployeeResults = workforce.table(
  'payroll_employee_results',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    runId: uuid('run_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    currency: text('currency').notNull().default('THB'),
    gross: numeric('gross', { precision: 19, scale: 4 }).notNull(),
    totalDeduction: numeric('total_deduction', { precision: 19, scale: 4 }).notNull(),
    employerContribution: numeric('employer_contribution', { precision: 19, scale: 4 }).notNull(),
    netPay: numeric('net_pay', { precision: 19, scale: 4 }).notNull(),
    taxableBase: numeric('taxable_base', { precision: 19, scale: 4 }).notNull(),
    socialSecurityBase: numeric('social_security_base', { precision: 19, scale: 4 }).notNull(),
    providentFundBase: numeric('provident_fund_base', { precision: 19, scale: 4 }).notNull(),
    warnings: jsonb('warnings').notNull().default([]),
    previousNetPay: numeric('previous_net_pay', { precision: 19, scale: 4 }),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('payroll_employee_results_key').on(table.runId, table.employmentId)],
);

export const payrollLines = workforce.table(
  'payroll_lines',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    resultId: uuid('result_id').notNull(),
    payItemCode: text('pay_item_code').notNull(),
    payItemName: text('pay_item_name').notNull(),
    category: text('category').notNull(),
    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
    taxable: boolean('taxable').notNull().default(false),
    affectsNetPay: boolean('affects_net_pay').notNull().default(true),
    employerOnly: boolean('employer_only').notNull().default(false),
    displayOrder: integer('display_order').notNull().default(100),
  },
  (table) => [index('payroll_lines_result_idx').on(table.tenantId, table.resultId)],
);

export const payrollLineCalculationTraces = workforce.table(
  'payroll_line_calculation_traces',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    lineId: uuid('line_id').notNull(),
    calculationType: text('calculation_type').notNull(),
    preRound: numeric('pre_round', { precision: 19, scale: 4 }).notNull(),
    rounding: text('rounding').notNull(),
    steps: jsonb('steps').notNull().default([]),
  },
  (table) => [uniqueIndex('payroll_line_calculation_traces_key').on(table.lineId)],
);

export const payrollYtdLedger = workforce.table(
  'payroll_ytd_ledger',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    periodYear: integer('period_year').notNull(),
    runId: uuid('run_id'),
    entryType: text('entry_type').notNull(),
    gross: numeric('gross', { precision: 19, scale: 4 }).notNull(),
    taxable: numeric('taxable', { precision: 19, scale: 4 }).notNull(),
    taxWithheld: numeric('tax_withheld', { precision: 19, scale: 4 }).notNull(),
    socialSecurity: numeric('social_security', { precision: 19, scale: 4 }).notNull(),
    providentFund: numeric('provident_fund', { precision: 19, scale: 4 }).notNull(),
    netPay: numeric('net_pay', { precision: 19, scale: 4 }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    reason: text('reason').notNull().default(''),
  },
  (table) => [
    index('payroll_ytd_ledger_lookup_idx').on(table.tenantId, table.employmentId, table.periodYear),
  ],
);

export const payrollTables = {
  payItemDefinitions,
  payItemFormulas,
  statutoryRuleSets,
  payrollTemplates,
  payrollTemplateItems,
  employmentPayItems,
  payrollPeriods,
  payrollRuns,
  payrollInputSnapshots,
  payrollSnapshotEmployments,
  payrollEmployeeResults,
  payrollLines,
  payrollLineCalculationTraces,
  payrollYtdLedger,
};
