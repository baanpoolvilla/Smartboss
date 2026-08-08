import { z } from 'zod';
import { isoDateSchema, isoDateTimeSchema, moneySchema, uuidSchema } from './common';

/**
 * Formula AST — โครงสร้างข้อมูล ไม่ใช่สตริงที่ต้อง eval (spec §9.4, §21)
 *
 * ใช้ `z.lazy` เพราะ node ซ้อนกันเองได้; schema จำกัดชนิดของ node ไว้ตายตัว
 * จึงไม่มีทางส่ง node แปลกปลอมเข้ามาให้ evaluator เจอ
 */
export const formulaNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('money'), value: moneySchema }),
    z.object({ kind: z.literal('rate'), value: z.string() }),
    z.object({ kind: z.literal('var'), name: z.string().min(1).max(64) }),
    z.object({ kind: z.literal('item'), code: z.string().min(1).max(64) }),
    z.object({ kind: z.literal('add'), left: formulaNodeSchema, right: formulaNodeSchema }),
    z.object({ kind: z.literal('subtract'), left: formulaNodeSchema, right: formulaNodeSchema }),
    z.object({ kind: z.literal('multiply'), money: formulaNodeSchema, rate: formulaNodeSchema }),
    z.object({ kind: z.literal('divide'), money: formulaNodeSchema, rate: formulaNodeSchema }),
    z.object({ kind: z.literal('min'), values: z.array(formulaNodeSchema).min(1).max(10) }),
    z.object({ kind: z.literal('max'), values: z.array(formulaNodeSchema).min(1).max(10) }),
    z.object({ kind: z.literal('cap'), value: formulaNodeSchema, ceiling: formulaNodeSchema }),
    z.object({ kind: z.literal('floor_at'), value: formulaNodeSchema, minimum: formulaNodeSchema }),
    z.object({
      kind: z.literal('round'),
      value: formulaNodeSchema,
      decimals: z.number().int().min(0).max(4),
      mode: z.enum(['HALF_UP', 'HALF_DOWN', 'HALF_EVEN', 'UP', 'DOWN', 'FLOOR', 'CEILING']),
    }),
    z.object({ kind: z.literal('minutes_to_hours'), minutes: formulaNodeSchema }),
    z.object({
      kind: z.literal('if_positive'),
      test: formulaNodeSchema,
      then: formulaNodeSchema,
      otherwise: formulaNodeSchema,
    }),
    z.object({
      kind: z.literal('bracket'),
      value: formulaNodeSchema,
      brackets: z
        .array(z.object({ size: z.string().nullable(), rate: z.string() }))
        .min(1)
        .max(20),
    }),
  ]),
);

export const createPayItemSchema = z.object({
  company_id: uuidSchema,
  code: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_]+$/),
  name: z.string().trim().min(1).max(120),
  category: z.enum(['EARNING', 'DEDUCTION', 'BENEFIT', 'EMPLOYER_CONTRIBUTION', 'INFORMATION']),
  calculation_type: z.enum([
    'FIXED',
    'MANUAL',
    'FORMULA',
    'ATTENDANCE',
    'PERCENTAGE',
    'IMPORT',
    'BALANCE_LEDGER',
  ]),
  formula: formulaNodeSchema.nullable().default(null),
  affects_net_pay: z.boolean().default(true),
  taxable: z.boolean().default(false),
  social_security_base: z.boolean().default(false),
  provident_fund_base: z.boolean().default(false),
  employer_only: z.boolean().default(false),
  rounding_decimals: z.number().int().min(0).max(4).default(2),
  rounding_mode: z
    .enum(['HALF_UP', 'HALF_DOWN', 'HALF_EVEN', 'UP', 'DOWN', 'FLOOR', 'CEILING'])
    .default('HALF_UP'),
  display_order: z.number().int().min(0).max(10_000).default(100),
  effective_from: isoDateSchema,
});

export const createRuleSetSchema = z.object({
  rule_type: z.enum([
    'TH_PIT_WITHHOLDING',
    'TH_SOCIAL_SECURITY',
    'PROVIDENT_FUND',
    'OT_MULTIPLIER',
    'SEVERANCE',
    'MINIMUM_WAGE',
  ]),
  version: z.string().trim().min(1).max(40),
  effective_from: isoDateSchema,
  effective_to: isoDateSchema.nullable().default(null),
  /** ค่าตามกฎหมายทั้งหมด เช่น sso_employee_rate, sso_contribution_ceiling */
  parameters: z.record(z.string()),
  /** ลิงก์ประกาศ/กฎหมายที่อ้างอิง — บังคับก่อน publish (spec §9.5) */
  source_reference: z.string().trim().max(500).default(''),
});

export const publishRuleSetSchema = z.object({
  approved_by: z.string().trim().min(1).max(120),
  /** golden test pack ของ rule type นี้ต้องผ่านแล้ว (spec §19.4) */
  golden_tests_passed: z.boolean(),
});

export const createPayrollPeriodSchema = z.object({
  company_id: uuidSchema,
  name: z.string().trim().min(1).max(120),
  starts_on: isoDateSchema,
  ends_on: isoDateSchema,
  pay_date: isoDateSchema,
  period_sequence: z.number().int().min(1).max(53),
});

export const createPayrollRunSchema = z.object({
  period_id: uuidSchema,
  timesheet_period_id: uuidSchema,
  run_type: z.enum(['REGULAR', 'OFF_CYCLE', 'ADJUSTMENT', 'FINAL_PAY']).default('REGULAR'),
});

export const submitPayrollRunSchema = z.object({
  /** ยกเว้นได้เฉพาะข้อที่ประกาศว่า waivable — negative net ยกเว้นไม่ได้ (spec §10.2) */
  waived_validations: z.array(z.string().max(60)).max(10).default([]),
});

export const approvePayrollRunSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const rejectPayrollRunSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const payrollRunSchema = z.object({
  id: uuidSchema,
  company_id: uuidSchema,
  period_id: uuidSchema,
  run_type: z.string(),
  status: z.enum([
    'DRAFT',
    'CALCULATING',
    'CALCULATED',
    'REVIEW',
    'APPROVED',
    'LOCKED',
    'PAYMENT_PENDING',
    'PARTIALLY_PAID',
    'PAID',
    'FILED',
    'FAILED',
    'VOID',
  ]),
  locked_at: isoDateTimeSchema.nullable(),
});

export const payrollResultSchema = z.object({
  id: uuidSchema,
  employment_id: uuidSchema,
  currency: z.string(),
  /** เงินเป็น string เสมอ (spec §13) */
  gross: moneySchema,
  total_deduction: moneySchema,
  employer_contribution: moneySchema,
  net_pay: moneySchema,
  warnings: z.array(z.record(z.unknown())),
  lines: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      category: z.string(),
      amount: moneySchema,
      employer_only: z.boolean(),
    }),
  ),
});

export const payrollTraceSchema = z.object({
  pay_item_code: z.string(),
  result: moneySchema,
  calculation_type: z.string(),
  pre_round: moneySchema,
  rounding: z.string(),
  steps: z.array(z.record(z.unknown())),
});

export type CreatePayItemInput = z.infer<typeof createPayItemSchema>;
export type CreateRuleSetInput = z.infer<typeof createRuleSetSchema>;
export type CreatePayrollRunInput = z.infer<typeof createPayrollRunSchema>;
