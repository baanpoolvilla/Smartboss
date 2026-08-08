import { schema, withTenant } from '@workforce/db';
import { LocalDate, uuidv4, uuidv7 } from '@workforce/domain';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createTestHarness, type TestHarness, type TestTenant } from './testing/test-app';

let harness: TestHarness;
let tenant: TestTenant;
let hrToken: string;
let adminToken: string;
let preparerToken: string;
let approverToken: string;
let dayShiftId: string;

async function createEmployment(name: string, salary: string): Promise<string> {
  const person = await call(harness, 'POST', '/people', {
    token: hrToken,
    idempotencyKey: uuidv4(),
    payload: { first_name: name, last_name: 'ทดสอบ' },
  });
  const employment = await call(harness, 'POST', '/employments', {
    token: hrToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      person_id: person.body['id'],
      employee_code: `P-${uuidv4().slice(0, 8)}`,
      employment_type: 'MONTHLY',
      hired_on: '2026-01-01',
    },
  });
  const employmentId = employment.body['id'] as string;

  await call(harness, 'POST', '/compensation-rates', {
    token: preparerToken,
    idempotencyKey: uuidv4(),
    payload: {
      employment_id: employmentId,
      pay_basis: 'MONTHLY',
      amount: salary,
      effective_from: '2026-01-01',
    },
  });

  await call(harness, 'POST', '/recurring-work-patterns', {
    token: adminToken,
    idempotencyKey: uuidv4(),
    payload: {
      employment_id: employmentId,
      monday_shift_id: dayShiftId,
      tuesday_shift_id: dayShiftId,
      wednesday_shift_id: dayShiftId,
      thursday_shift_id: dayShiftId,
      friday_shift_id: dayShiftId,
      saturday_shift_id: null,
      sunday_shift_id: null,
      effective_from: '2026-01-01',
    },
  });

  return employmentId;
}

async function publishRuleSets(): Promise<void> {
  const sets: { rule_type: string; parameters: Record<string, string> }[] = [
    {
      rule_type: 'TH_SOCIAL_SECURITY',
      parameters: {
        sso_employee_rate: '0.05',
        sso_employer_rate: '0.05',
        sso_wage_ceiling: '15000.0000',
        sso_contribution_ceiling: '750.0000',
        standard_days_per_month: '30',
        standard_hours_per_day: '8',
      },
    },
    {
      rule_type: 'OT_MULTIPLIER',
      parameters: { ot_workday_multiplier: '1.5', ot_holiday_multiplier: '3.0' },
    },
    {
      rule_type: 'TH_PIT_WITHHOLDING',
      parameters: { pit_expense_rate: '0.5', pit_expense_ceiling: '100000.0000' },
    },
  ];

  for (const entry of sets) {
    const created = await call(harness, 'POST', '/statutory-rule-sets', {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {
        rule_type: entry.rule_type,
        version: '2026.1',
        effective_from: '2026-01-01',
        parameters: entry.parameters,
        source_reference: 'docs/phase0/rule-matrix.md (ทดสอบ)',
      },
    });
    expect(created.status).toBe(201);

    const published = await call(
      harness,
      'POST',
      `/statutory-rule-sets/${created.body['id'] as string}/publish`,
      {
        token: approverToken,
        idempotencyKey: uuidv4(),
        payload: { approved_by: 'payroll-sme-test', golden_tests_passed: true },
      },
    );
    expect(published.status).toBe(200);
  }
}

async function publishPayItems(): Promise<void> {
  const items = [
    {
      code: 'SALARY',
      name: 'เงินเดือน',
      category: 'EARNING',
      calculation_type: 'FORMULA',
      formula: { kind: 'var', name: 'monthly_salary' },
      taxable: true,
      social_security_base: true,
      display_order: 10,
    },
    {
      code: 'OVERTIME_WORKDAY',
      name: 'ค่าล่วงเวลา',
      category: 'EARNING',
      calculation_type: 'ATTENDANCE',
      formula: {
        kind: 'multiply',
        money: {
          kind: 'multiply',
          money: { kind: 'var', name: 'hourly_rate' },
          rate: { kind: 'minutes_to_hours', minutes: { kind: 'var', name: 'ot_workday_minutes' } },
        },
        rate: { kind: 'var', name: 'ot_workday_multiplier' },
      },
      taxable: true,
      social_security_base: false,
      display_order: 20,
    },
    {
      code: 'SOCIAL_SECURITY_EMPLOYEE',
      name: 'ประกันสังคม',
      category: 'DEDUCTION',
      calculation_type: 'PERCENTAGE',
      formula: {
        kind: 'cap',
        value: {
          kind: 'multiply',
          money: {
            kind: 'cap',
            value: { kind: 'item', code: 'SALARY' },
            ceiling: { kind: 'var', name: 'sso_wage_ceiling' },
          },
          rate: { kind: 'var', name: 'sso_employee_rate' },
        },
        ceiling: { kind: 'var', name: 'sso_contribution_ceiling' },
      },
      taxable: false,
      social_security_base: false,
      display_order: 50,
    },
  ];

  for (const item of items) {
    const created = await call(harness, 'POST', '/pay-items', {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {
        company_id: tenant.companyId,
        code: item.code,
        name: item.name,
        category: item.category,
        calculation_type: item.calculation_type,
        formula: item.formula,
        taxable: item.taxable,
        social_security_base: item.social_security_base,
        display_order: item.display_order,
        effective_from: '2026-01-01',
      },
    });
    expect(created.status).toBe(201);

    const published = await call(
      harness,
      'POST',
      `/pay-items/${created.body['id'] as string}/publish`,
      { token: preparerToken, idempotencyKey: uuidv4(), payload: {} },
    );
    expect(published.status).toBe(200);
  }
}

// หนึ่งงวดต่อบริษัทต่อช่วงวันที่ — เลื่อนวันสิ้นสุดให้แต่ละครั้งมีงวดของตัวเอง
let timesheetPeriodOffset = 0;

/** ปิด timesheet ให้พร้อมทำ payroll */
async function closedTimesheetPeriod(employmentIds: readonly string[]): Promise<string> {
  timesheetPeriodOffset += 1;
  const endsOn = LocalDate.parse('2026-08-09').plusDays(timesheetPeriodOffset).toString();
  for (const employmentId of employmentIds) {
    await withTenant(harness.database.db, tenant.tenantId, async (tx) => {
      for (const day of ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']) {
        await tx.insert(schema.rawTimeEvents).values([
          {
            id: uuidv7(),
            tenantId: tenant.tenantId,
            companyId: tenant.companyId,
            employmentId,
            sourceType: 'MANUAL',
            eventIntent: 'CLOCK_IN',
            capturedAt: new Date(`${day}T01:00:00Z`),
            timeZone: 'Asia/Bangkok',
            payloadHash: Buffer.alloc(32),
            evidence: {},
            clientContext: {},
            status: 'ACCEPTED',
          },
          {
            id: uuidv7(),
            tenantId: tenant.tenantId,
            companyId: tenant.companyId,
            employmentId,
            sourceType: 'MANUAL',
            eventIntent: 'CLOCK_OUT',
            capturedAt: new Date(`${day}T10:00:00Z`),
            timeZone: 'Asia/Bangkok',
            payloadHash: Buffer.alloc(32),
            evidence: {},
            clientContext: {},
            status: 'ACCEPTED',
          },
        ]);
      }
    });

    await call(harness, 'POST', '/attendance-results:recalculate', {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { employment_id: employmentId, from: '2026-08-03', to: '2026-08-09' },
    });
  }

  const period = await call(harness, 'POST', '/timesheet-periods', {
    token: hrToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      name: `งวด ${uuidv4().slice(0, 6)}`,
      starts_on: '2026-08-03',
      ends_on: endsOn,
    },
  });
  expect(period.status).toBe(201);
  const periodId = period.body['id'] as string;

  await call(harness, 'POST', `/timesheet-periods/${periodId}/generate`, {
    token: hrToken,
    idempotencyKey: uuidv4(),
    payload: {},
  });
  const closed = await call(harness, 'POST', `/timesheet-periods/${periodId}/close`, {
    token: hrToken,
    idempotencyKey: uuidv4(),
    payload: { force: true, reason: 'ปิดงวดสำหรับทดสอบ payroll' },
  });
  expect(closed.status).toBe(200);

  return periodId;
}

let periodSequence = 0;

async function createPayrollRun(timesheetPeriodId: string): Promise<string> {
  periodSequence += 1;
  const period = await call(harness, 'POST', '/payroll-periods', {
    token: preparerToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      name: `เงินเดือนงวด ${String(periodSequence)}`,
      starts_on: '2026-08-01',
      ends_on: '2026-08-31',
      pay_date: '2026-08-31',
      period_sequence: periodSequence,
    },
  });
  expect(period.status).toBe(201);

  const run = await call(harness, 'POST', '/payroll-runs', {
    token: preparerToken,
    idempotencyKey: uuidv4(),
    payload: {
      period_id: period.body['id'],
      timesheet_period_id: timesheetPeriodId,
      run_type: 'REGULAR',
    },
  });
  expect(run.status).toBe(201);
  return run.body['id'] as string;
}

beforeAll(async () => {
  harness = await createTestHarness();
  tenant = await harness.createTenant('payroll');

  await harness.createPrincipal(tenant, { subject: 'y|hr', roles: ['HR_OFFICER'] });
  await harness.createPrincipal(tenant, { subject: 'y|admin', roles: ['TENANT_ADMIN', 'HR_OFFICER'] });
  await harness.createPrincipal(tenant, { subject: 'y|prep', roles: ['PAYROLL_PREPARER'] });
  await harness.createPrincipal(tenant, { subject: 'y|appr', roles: ['PAYROLL_APPROVER'] });

  hrToken = await harness.token('y|hr', tenant.tenantId);
  adminToken = await harness.token('y|admin', tenant.tenantId);
  preparerToken = await harness.token('y|prep', tenant.tenantId);
  approverToken = await harness.token('y|appr', tenant.tenantId);

  await call(harness, 'POST', '/work-policies', {
    token: adminToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      code: 'STD',
      name: 'มาตรฐาน',
      late_mode: 'GRACE',
      grace_minutes: 15,
      effective_from: '2026-01-01',
    },
  });

  const shift = await call(harness, 'POST', '/shifts', {
    token: adminToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      code: 'DAY',
      name: 'กะกลางวัน',
      start: '08:00',
      end: '17:00',
      breaks: [{ start: '12:00', duration_minutes: 60, paid: false, auto_deduct: true }],
    },
  });
  dayShiftId = shift.body['id'] as string;

  await publishRuleSets();
  await publishPayItems();
}, 240_000);

afterAll(async () => {
  await harness.close();
});

describe('statutory rule sets', () => {
  it('refuses to publish without a sign-off', async () => {
    // spec §9.5 — ทั้ง engine และ CHECK constraint บังคับข้อนี้
    const created = await call(harness, 'POST', '/statutory-rule-sets', {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {
        rule_type: 'MINIMUM_WAGE',
        version: 'unsigned',
        effective_from: '2026-01-01',
        parameters: { minimum_daily_wage: '400.0000' },
        source_reference: '',
      },
    });

    const published = await call(
      harness,
      'POST',
      `/statutory-rule-sets/${created.body['id'] as string}/publish`,
      {
        token: approverToken,
        idempotencyKey: uuidv4(),
        payload: { approved_by: 'someone', golden_tests_passed: false },
      },
    );

    // 409 ไม่ใช่ 500 — เป็นการปฏิเสธตามกฎที่คาดไว้แล้ว และข้อความต้องบอกว่าขาดอะไร
    expect(published.status).toBe(409);
    expect(published.body['title']).toContain('sourceReference is required');
    expect(published.body['title']).toContain('golden test pack');
    const stored = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.statutoryRuleSets)
        .where(eq(schema.statutoryRuleSets.id, created.body['id'] as string)),
    );
    // ยังเป็น DRAFT — ไม่มีทางหลุดเข้าไปคำนวณเงินจริง
    expect(stored[0]?.status).toBe('DRAFT');
  });

  it('rejects a published rule set written directly without sign-off', async () => {
    await expect(
      withTenant(harness.database.db, tenant.tenantId, async (tx) => {
        await tx.insert(schema.statutoryRuleSets).values({
          id: uuidv7(),
          tenantId: tenant.tenantId,
          ruleType: 'SEVERANCE',
          version: 'bypass-attempt',
          status: 'PUBLISHED',
          effectiveFrom: '2026-01-01',
          parameters: {},
          sourceReference: '',
          approvedBy: null,
          approvedAt: null,
          goldenTestsPassed: false,
        });
      }),
    ).rejects.toThrow();
  });
});

describe('payroll run lifecycle', () => {
  it('runs the full path from snapshot to lock', async () => {
    const employmentId = await createEmployment('เงินเดือนเต็มงวด', '30000.00');
    const timesheetPeriodId = await closedTimesheetPeriod([employmentId]);
    const runId = await createPayrollRun(timesheetPeriodId);

    const snapshot = await call(harness, 'POST', `/payroll-runs/${runId}/snapshot`, {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
    expect(snapshot.status).toBe(200);
    expect(snapshot.body['employment_count']).toBe(1);
    expect(snapshot.body['missing_rule_sets']).toEqual([]);

    const calculated = await call(harness, 'POST', `/payroll-runs/${runId}/calculate`, {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
    expect(calculated.status).toBe(200);
    expect(calculated.body['negative_net_count']).toBe(0);
    expect(calculated.body['calculation_error_count']).toBe(0);

    const results = await call(harness, 'GET', `/payroll-runs/${runId}/employees`, {
      token: preparerToken,
    });
    const result = (results.body['items'] as Record<string, unknown>[])[0];

    expect(result?.['gross']).toBe('30000.0000');
    // เพดานค่าจ้าง 15,000 × 5% = 750 ซึ่งชนเพดานเงินสมทบพอดี
    expect(result?.['total_deduction']).toBe('750.0000');
    expect(result?.['net_pay']).toBe('29250.0000');

    const submitted = await call(harness, 'POST', `/payroll-runs/${runId}/submit`, {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: { waived_validations: ['BLOCKING_ATTENDANCE_EXCEPTIONS'] },
    });
    expect(submitted.status).toBe(200);

    const approved = await call(harness, 'POST', `/payroll-runs/${runId}/approve`, {
      token: approverToken,
      idempotencyKey: uuidv4(),
      payload: { reason: 'ตรวจสอบยอดแล้วถูกต้อง' },
    });
    expect(approved.status).toBe(200);

    const locked = await call(harness, 'POST', `/payroll-runs/${runId}/lock`, {
      token: approverToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
    expect(locked.status).toBe(200);
    expect(locked.body['status']).toBe('LOCKED');
  });

  it('refuses to build a snapshot from an open timesheet period', async () => {
    const employmentId = await createEmployment('งวดยังไม่ปิด', '25000.00');
    const period = await call(harness, 'POST', '/timesheet-periods', {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: {
        company_id: tenant.companyId,
        name: `เปิดอยู่ ${uuidv4().slice(0, 6)}`,
        starts_on: '2026-09-01',
        ends_on: '2026-09-07',
      },
    });
    expect(employmentId).toBeTruthy();

    const runId = await createPayrollRun(period.body['id'] as string);
    const snapshot = await call(harness, 'POST', `/payroll-runs/${runId}/snapshot`, {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
    // spec §10.2: ต้องมี closed timesheet snapshot ก่อน
    expect(snapshot.status).toBe(409);
  });

  it('refuses to let the preparer approve their own run', async () => {
    const employmentId = await createEmployment('อนุมัติเอง', '20000.00');
    const timesheetPeriodId = await closedTimesheetPeriod([employmentId]);
    const runId = await createPayrollRun(timesheetPeriodId);

    await call(harness, 'POST', `/payroll-runs/${runId}/snapshot`, {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
    await call(harness, 'POST', `/payroll-runs/${runId}/calculate`, {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
    await call(harness, 'POST', `/payroll-runs/${runId}/submit`, {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: { waived_validations: ['BLOCKING_ATTENDANCE_EXCEPTIONS'] },
    });

    // PAYROLL_PREPARER ไม่มีสิทธิ์ approve เลย — นั่นคือชั้นแรกของ maker-checker
    const selfApprove = await call(harness, 'POST', `/payroll-runs/${runId}/approve`, {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: { reason: 'อนุมัติเอง' },
    });
    expect(selfApprove.status).toBe(403);
  });

  it('rejects an out-of-order transition', async () => {
    const employmentId = await createEmployment('ข้ามขั้น', '20000.00');
    const timesheetPeriodId = await closedTimesheetPeriod([employmentId]);
    const runId = await createPayrollRun(timesheetPeriodId);

    // DRAFT → APPROVED ไม่อยู่ในตาราง transition (spec §10)
    const approved = await call(harness, 'POST', `/payroll-runs/${runId}/approve`, {
      token: approverToken,
      idempotencyKey: uuidv4(),
      payload: { reason: 'ข้ามขั้นตอน' },
    });
    expect(approved.status).toBe(409);
  });
});

describe('locked payroll is immutable', () => {
  let lockedRunId: string;
  let lockedEmploymentId: string;

  beforeAll(async () => {
    lockedEmploymentId = await createEmployment('ล็อกแล้ว', '30000.00');
    const timesheetPeriodId = await closedTimesheetPeriod([lockedEmploymentId]);
    lockedRunId = await createPayrollRun(timesheetPeriodId);

    await call(harness, 'POST', `/payroll-runs/${lockedRunId}/snapshot`, {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
    await call(harness, 'POST', `/payroll-runs/${lockedRunId}/calculate`, {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
    await call(harness, 'POST', `/payroll-runs/${lockedRunId}/submit`, {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: { waived_validations: ['BLOCKING_ATTENDANCE_EXCEPTIONS'] },
    });
    await call(harness, 'POST', `/payroll-runs/${lockedRunId}/approve`, {
      token: approverToken,
      idempotencyKey: uuidv4(),
      payload: { reason: 'ตรวจแล้ว' },
    });
    await call(harness, 'POST', `/payroll-runs/${lockedRunId}/lock`, {
      token: approverToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
  }, 120_000);

  it('refuses to recalculate through the API', async () => {
    const response = await call(harness, 'POST', `/payroll-runs/${lockedRunId}/calculate`, {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
    expect(response.status).toBe(409);
    expect(response.body['code']).toBe('IMMUTABLE_RESOURCE');
  });

  it('refuses a direct UPDATE on the results at the database level', async () => {
    // spec §19.5: locked payroll update/delete ไม่ได้ทั้ง API และ DB guard
    await expect(
      withTenant(harness.database.db, tenant.tenantId, async (tx) => {
        await tx
          .update(schema.payrollEmployeeResults)
          .set({ netPay: '999999.0000' })
          .where(eq(schema.payrollEmployeeResults.runId, lockedRunId));
      }),
    ).rejects.toThrow();
  });

  it('refuses a direct DELETE on the lines at the database level', async () => {
    const results = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.payrollEmployeeResults)
        .where(eq(schema.payrollEmployeeResults.runId, lockedRunId)),
    );
    const resultId = results[0]?.id as string;

    await expect(
      withTenant(harness.database.db, tenant.tenantId, async (tx) => {
        await tx.delete(schema.payrollLines).where(eq(schema.payrollLines.resultId, resultId));
      }),
    ).rejects.toThrow();
  });

  it('records a YTD ledger entry that cannot be edited', async () => {
    const entries = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.payrollYtdLedger)
        .where(eq(schema.payrollYtdLedger.employmentId, lockedEmploymentId)),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entryType).toBe('PAYROLL');

    await expect(
      withTenant(harness.database.db, tenant.tenantId, async (tx) => {
        await tx
          .update(schema.payrollYtdLedger)
          .set({ gross: '1.0000' })
          .where(eq(schema.payrollYtdLedger.employmentId, lockedEmploymentId));
      }),
    ).rejects.toThrow();
  });

  it('refuses to modify the input snapshot after it was built', async () => {
    await expect(
      withTenant(harness.database.db, tenant.tenantId, async (tx) => {
        await tx
          .update(schema.payrollInputSnapshots)
          .set({ employmentCount: 0 })
          .where(eq(schema.payrollInputSnapshots.runId, lockedRunId));
      }),
    ).rejects.toThrow();
  });
});

describe('calculation trace', () => {
  it('explains where every number came from', async () => {
    const employmentId = await createEmployment('อธิบายได้', '30000.00');
    const timesheetPeriodId = await closedTimesheetPeriod([employmentId]);
    const runId = await createPayrollRun(timesheetPeriodId);

    await call(harness, 'POST', `/payroll-runs/${runId}/snapshot`, {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
    await call(harness, 'POST', `/payroll-runs/${runId}/calculate`, {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });

    const trace = await call(
      harness,
      'GET',
      `/payroll-runs/${runId}/employees/${employmentId}/trace`,
      { token: preparerToken },
    );

    expect(trace.status).toBe(200);
    const items = trace.body['items'] as Record<string, unknown>[];
    const sso = items.find((item) => item['pay_item_code'] === 'SOCIAL_SECURITY_EMPLOYEE');

    // spec §9.4: ต้องบอกได้ทั้งค่าก่อนปัด วิธีปัด และทุกขั้นตอนของสูตร
    expect(sso?.['pre_round']).toBe('750.0000');
    expect(sso?.['rounding']).toBe('HALF_UP_2');
    const steps = sso?.['steps'] as { node: string }[];
    expect(steps.map((step) => step.node)).toContain('cap');
  });

  it('produces identical results when recalculated from the same snapshot', async () => {
    // spec §17: payroll reproducibility 100%
    const employmentId = await createEmployment('คำนวณซ้ำ', '27500.00');
    const timesheetPeriodId = await closedTimesheetPeriod([employmentId]);
    const runId = await createPayrollRun(timesheetPeriodId);

    await call(harness, 'POST', `/payroll-runs/${runId}/snapshot`, {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });

    const readNet = async (): Promise<string> => {
      const results = await call(harness, 'GET', `/payroll-runs/${runId}/employees`, {
        token: preparerToken,
      });
      return (results.body['items'] as Record<string, unknown>[])[0]?.['net_pay'] as string;
    };

    await call(harness, 'POST', `/payroll-runs/${runId}/calculate`, {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
    const first = await readNet();

    // เลื่อนนาฬิกาไปข้างหน้าแล้วคำนวณใหม่ — ผลต้องเท่าเดิม
    harness.clock.advanceBy(3 * 3600_000);
    try {
      await call(harness, 'POST', `/payroll-runs/${runId}/calculate`, {
        token: preparerToken,
        idempotencyKey: uuidv4(),
        payload: {},
      });
    } finally {
      harness.clock.advanceBy(-3 * 3600_000);
    }
    expect(await readNet()).toBe(first);
  });

  it('keeps the totals equal to the sum of the stored lines', async () => {
    const employmentId = await createEmployment('ยอดตรง', '18000.00');
    const timesheetPeriodId = await closedTimesheetPeriod([employmentId]);
    const runId = await createPayrollRun(timesheetPeriodId);

    await call(harness, 'POST', `/payroll-runs/${runId}/snapshot`, {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
    await call(harness, 'POST', `/payroll-runs/${runId}/calculate`, {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });

    const stored = await withTenant(harness.database.db, tenant.tenantId, async (tx) => {
      const results = await tx
        .select()
        .from(schema.payrollEmployeeResults)
        .where(
          and(
            eq(schema.payrollEmployeeResults.runId, runId),
            eq(schema.payrollEmployeeResults.employmentId, employmentId),
          ),
        );
      const lines = await tx
        .select()
        .from(schema.payrollLines)
        .where(eq(schema.payrollLines.resultId, results[0]?.id as string));
      return { result: results[0], lines };
    });

    const sum = (predicate: (line: (typeof stored.lines)[number]) => boolean): number =>
      stored.lines.filter(predicate).reduce((total, line) => total + Number(line.amount), 0);

    const earnings = sum((line) => line.category === 'EARNING' && line.affectsNetPay);
    const deductions = sum((line) => line.category === 'DEDUCTION' && line.affectsNetPay);

    expect(Number(stored.result?.gross)).toBe(earnings);
    expect(Number(stored.result?.totalDeduction)).toBe(deductions);
    expect(Number(stored.result?.netPay)).toBe(earnings - deductions);
  });
});
