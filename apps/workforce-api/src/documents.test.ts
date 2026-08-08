import { schema, withTenant } from '@workforce/db';
import { LocalDate, Money, uuidv4, uuidv7 } from '@workforce/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createTestHarness, type TestHarness, type TestTenant } from './testing/test-app';

let harness: TestHarness;
let tenant: TestTenant;
let hrToken: string;
let adminToken: string;
let preparerToken: string;
let approverToken: string;
let financeToken: string;
let dayShiftId: string;
let bankProfileId: string;

/** run ที่ล็อกแล้วพร้อมพนักงานสองคน — จุดตั้งต้นของทุก test ในไฟล์นี้ */
let lockedRunId: string;
let employeeA: { employmentId: string; token: string };
let employeeB: { employmentId: string; token: string };

let periodOffset = 0;

async function createEmployee(name: string, salary: string): Promise<{ employmentId: string; token: string }> {
  const person = await call(harness, 'POST', '/people', {
    token: hrToken,
    idempotencyKey: uuidv4(),
    payload: { first_name: name, last_name: 'ทดสอบ' },
  });
  const personId = person.body['id'] as string;

  const employment = await call(harness, 'POST', '/employments', {
    token: hrToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      person_id: personId,
      employee_code: `D-${uuidv4().slice(0, 8)}`,
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

  const subject = `d|${uuidv4().slice(0, 8)}`;
  await harness.createPrincipal(tenant, { subject, roles: ['EMPLOYEE'], personId });

  return { employmentId, token: await harness.token(subject, tenant.tenantId) };
}

async function lockedPayrollRun(employmentIds: readonly string[]): Promise<string> {
  periodOffset += 1;

  for (const employmentId of employmentIds) {
    await withTenant(harness.database.db, tenant.tenantId, async (tx) => {
      for (const day of ['2026-08-03', '2026-08-04', '2026-08-05']) {
        for (const [intent, time] of [
          ['CLOCK_IN', '01:00:00'],
          ['CLOCK_OUT', '10:00:00'],
        ] as const) {
          await tx.insert(schema.rawTimeEvents).values({
            id: uuidv7(),
            tenantId: tenant.tenantId,
            companyId: tenant.companyId,
            employmentId,
            sourceType: 'MANUAL',
            eventIntent: intent,
            capturedAt: new Date(`${day}T${time}Z`),
            timeZone: 'Asia/Bangkok',
            payloadHash: Buffer.alloc(32),
            evidence: {},
            clientContext: {},
            status: 'ACCEPTED',
          });
        }
      }
    });

    await call(harness, 'POST', '/attendance-results:recalculate', {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { employment_id: employmentId, from: '2026-08-03', to: '2026-08-07' },
    });
  }

  const timesheetPeriod = await call(harness, 'POST', '/timesheet-periods', {
    token: hrToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      name: `งวด ${String(periodOffset)}`,
      starts_on: '2026-08-03',
      ends_on: LocalDate.parse('2026-08-09').plusDays(periodOffset).toString(),
    },
  });
  const timesheetPeriodId = timesheetPeriod.body['id'] as string;

  await call(harness, 'POST', `/timesheet-periods/${timesheetPeriodId}/generate`, {
    token: hrToken,
    idempotencyKey: uuidv4(),
    payload: {},
  });
  await call(harness, 'POST', `/timesheet-periods/${timesheetPeriodId}/close`, {
    token: hrToken,
    idempotencyKey: uuidv4(),
    payload: { force: true, reason: 'ปิดงวดสำหรับทดสอบเอกสาร' },
  });

  const payrollPeriod = await call(harness, 'POST', '/payroll-periods', {
    token: preparerToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      name: `เงินเดือน ${String(periodOffset)}`,
      starts_on: '2026-08-01',
      ends_on: '2026-08-31',
      pay_date: '2026-08-31',
      period_sequence: periodOffset,
    },
  });

  const run = await call(harness, 'POST', '/payroll-runs', {
    token: preparerToken,
    idempotencyKey: uuidv4(),
    payload: {
      period_id: payrollPeriod.body['id'],
      timesheet_period_id: timesheetPeriodId,
      run_type: 'REGULAR',
    },
  });
  const runId = run.body['id'] as string;

  for (const step of ['snapshot', 'calculate'] as const) {
    const response = await call(harness, 'POST', `/payroll-runs/${runId}/${step}`, {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
    expect(response.status).toBe(200);
  }

  await call(harness, 'POST', `/payroll-runs/${runId}/submit`, {
    token: preparerToken,
    idempotencyKey: uuidv4(),
    payload: { waived_validations: ['BLOCKING_ATTENDANCE_EXCEPTIONS'] },
  });
  await call(harness, 'POST', `/payroll-runs/${runId}/approve`, {
    token: approverToken,
    idempotencyKey: uuidv4(),
    payload: { reason: 'ตรวจแล้ว' },
  });
  const locked = await call(harness, 'POST', `/payroll-runs/${runId}/lock`, {
    token: approverToken,
    idempotencyKey: uuidv4(),
    payload: {},
  });
  expect(locked.status).toBe(200);

  return runId;
}

beforeAll(async () => {
  harness = await createTestHarness();
  tenant = await harness.createTenant('documents');

  await harness.createPrincipal(tenant, { subject: 'q|hr', roles: ['HR_OFFICER'] });
  await harness.createPrincipal(tenant, { subject: 'q|admin', roles: ['TENANT_ADMIN', 'HR_OFFICER'] });
  await harness.createPrincipal(tenant, { subject: 'q|prep', roles: ['PAYROLL_PREPARER'] });
  await harness.createPrincipal(tenant, { subject: 'q|appr', roles: ['PAYROLL_APPROVER'] });
  await harness.createPrincipal(tenant, { subject: 'q|fin', roles: ['FINANCE_OFFICER'] });

  hrToken = await harness.token('q|hr', tenant.tenantId);
  adminToken = await harness.token('q|admin', tenant.tenantId);
  preparerToken = await harness.token('q|prep', tenant.tenantId);
  approverToken = await harness.token('q|appr', tenant.tenantId);
  financeToken = await harness.token('q|fin', tenant.tenantId);

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
    },
  });
  dayShiftId = shift.body['id'] as string;

  // ชุดกฎขั้นต่ำที่ payroll run ต้องมีครบ
  for (const entry of [
    {
      rule_type: 'TH_SOCIAL_SECURITY',
      parameters: {
        sso_employee_rate: '0.05',
        sso_wage_ceiling: '15000.0000',
        sso_contribution_ceiling: '750.0000',
        standard_days_per_month: '30',
        standard_hours_per_day: '8',
      },
    },
    { rule_type: 'OT_MULTIPLIER', parameters: { ot_workday_multiplier: '1.5' } },
    { rule_type: 'TH_PIT_WITHHOLDING', parameters: { pit_expense_rate: '0.5' } },
  ]) {
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
    await call(harness, 'POST', `/statutory-rule-sets/${created.body['id'] as string}/publish`, {
      token: approverToken,
      idempotencyKey: uuidv4(),
      payload: { approved_by: 'payroll-sme-test', golden_tests_passed: true },
    });
  }

  const salaryItem = await call(harness, 'POST', '/pay-items', {
    token: preparerToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      code: 'SALARY',
      name: 'เงินเดือน',
      category: 'EARNING',
      calculation_type: 'FORMULA',
      formula: { kind: 'var', name: 'monthly_salary' },
      taxable: true,
      social_security_base: true,
      display_order: 10,
      effective_from: '2026-01-01',
    },
  });
  await call(harness, 'POST', `/pay-items/${salaryItem.body['id'] as string}/publish`, {
    token: preparerToken,
    idempotencyKey: uuidv4(),
    payload: {},
  });

  const ssoItem = await call(harness, 'POST', '/pay-items', {
    token: preparerToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
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
      display_order: 50,
      effective_from: '2026-01-01',
    },
  });
  await call(harness, 'POST', `/pay-items/${ssoItem.body['id'] as string}/publish`, {
    token: preparerToken,
    idempotencyKey: uuidv4(),
    payload: {},
  });

  const bank = await call(harness, 'POST', '/bank-profiles', {
    token: financeToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      code: 'KBANK',
      name: 'กสิกรไทย',
      bank_code: '004',
      account_number: '1234567890',
    },
  });
  expect(bank.status).toBe(201);
  bankProfileId = bank.body['id'] as string;

  employeeA = await createEmployee('พนักงานเอ', '30000.00');
  employeeB = await createEmployee('พนักงานบี', '18000.00');
  lockedRunId = await lockedPayrollRun([employeeA.employmentId, employeeB.employmentId]);
}, 300_000);

afterAll(async () => {
  await harness.close();
});

describe('payslips', () => {
  it('publishes payslips whose totals equal the locked result', async () => {
    // spec §19.5: payslip totals เท่ากับ locked result
    const published = await call(harness, 'POST', `/payroll-runs/${lockedRunId}/payslips:publish`, {
      token: approverToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
    expect(published.status).toBe(200);
    expect(published.body['published']).toBe(2);

    const stored = await withTenant(harness.database.db, tenant.tenantId, async (tx) => {
      const slips = await tx
        .select()
        .from(schema.payslipDocuments)
        .where(eq(schema.payslipDocuments.runId, lockedRunId));
      const results = await tx
        .select()
        .from(schema.payrollEmployeeResults)
        .where(eq(schema.payrollEmployeeResults.runId, lockedRunId));
      return { slips, results };
    });

    expect(stored.slips).toHaveLength(2);
    for (const slip of stored.slips) {
      const result = stored.results.find((row) => row.id === slip.resultId);
      expect(slip.gross).toBe(result?.gross);
      expect(slip.totalDeduction).toBe(result?.totalDeduction);
      expect(slip.netPay).toBe(result?.netPay);
    }
  });

  it('refuses to publish payslips from a run that is not locked', async () => {
    const employee = await createEmployee('ยังไม่ล็อก', '20000.00');
    const timesheetPeriod = await call(harness, 'POST', '/timesheet-periods', {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: {
        company_id: tenant.companyId,
        name: 'งวดยังไม่ปิด',
        starts_on: '2026-10-01',
        ends_on: '2026-10-07',
      },
    });
    const payrollPeriod = await call(harness, 'POST', '/payroll-periods', {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {
        company_id: tenant.companyId,
        name: 'งวดยังไม่ล็อก',
        starts_on: '2026-10-01',
        ends_on: '2026-10-31',
        pay_date: '2026-10-31',
        period_sequence: 40,
      },
    });
    const run = await call(harness, 'POST', '/payroll-runs', {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {
        period_id: payrollPeriod.body['id'],
        timesheet_period_id: timesheetPeriod.body['id'],
        run_type: 'REGULAR',
      },
    });
    expect(employee.employmentId).toBeTruthy();

    const published = await call(
      harness,
      'POST',
      `/payroll-runs/${run.body['id'] as string}/payslips:publish`,
      { token: approverToken, idempotencyKey: uuidv4(), payload: {} },
    );
    expect(published.status).toBe(409);
  });

  it('lets an employee see only their own payslip', async () => {
    const mine = await call(harness, 'GET', '/me/payslips', { token: employeeA.token });
    expect(mine.status).toBe(200);

    const items = mine.body['items'] as { id: string; net_pay: string }[];
    expect(items).toHaveLength(1);
    expect(items[0]?.net_pay).toBe('29250.0000');

    const theirs = await call(harness, 'GET', '/me/payslips', { token: employeeB.token });
    const theirItems = theirs.body['items'] as { id: string }[];
    expect(theirItems).toHaveLength(1);
    expect(theirItems[0]?.id).not.toBe(items[0]?.id);
  });

  it('hides another employee payslip behind 404, not 403', async () => {
    const theirs = await call(harness, 'GET', '/me/payslips', { token: employeeB.token });
    const otherPayslipId = (theirs.body['items'] as { id: string }[])[0]?.id as string;

    const attempt = await call(harness, 'GET', `/payslips/${otherPayslipId}/download-url`, {
      token: employeeA.token,
    });
    // 403 จะเป็นการยืนยันว่าสลิปใบนั้นมีอยู่จริง (ADR-0005)
    expect(attempt.status).toBe(404);
  });

  it('audits every payslip download', async () => {
    const mine = await call(harness, 'GET', '/me/payslips', { token: employeeA.token });
    const payslipId = (mine.body['items'] as { id: string }[])[0]?.id as string;

    const download = await call(harness, 'GET', `/payslips/${payslipId}/download-url`, {
      token: employeeA.token,
    });
    expect(download.status).toBe(200);
    expect(String(download.body['url'])).toContain('signature=');

    const accesses = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.payslipAccessLog)
        .where(eq(schema.payslipAccessLog.payslipId, payslipId)),
    );
    expect(accesses.length).toBeGreaterThan(0);

    const audit = await call(harness, 'GET', '/audit-events?action=payslip.download', {
      token: adminToken,
    });
    expect((audit.body['items'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('refuses to edit a published payslip', async () => {
    await expect(
      withTenant(harness.database.db, tenant.tenantId, async (tx) => {
        await tx
          .update(schema.payslipDocuments)
          .set({ netPay: '1.0000' })
          .where(eq(schema.payslipDocuments.runId, lockedRunId));
      }),
    ).rejects.toThrow();
  });
});

describe('bank batch', () => {
  it('keeps the control total equal to the sum of its items', async () => {
    // spec §19.5: bank control total เท่ากับ items
    const batch = await call(harness, 'POST', '/bank-batches', {
      token: financeToken,
      idempotencyKey: uuidv4(),
      payload: {
        run_id: lockedRunId,
        bank_profile_id: bankProfileId,
        value_date: '2026-08-31',
      },
    });

    expect(batch.status).toBe(201);
    expect(batch.body['control_count']).toBe(2);
    // ทั้งสองคนชนเพดานเงินสมทบ 750 เท่ากัน (15,000 × 5% = 750)
    // A: 30,000 − 750 = 29,250 | B: 18,000 − 750 = 17,250 → รวม 46,500
    expect(batch.body['control_total']).toBe('46500.0000');

    const verify = await call(
      harness,
      'GET',
      `/bank-batches/${batch.body['id'] as string}/verify`,
      { token: financeToken },
    );
    expect(verify.body['matches']).toBe(true);
    expect(verify.body['actual_total']).toBe(verify.body['control_total']);
  });

  it('detects a tampered item and refuses to mark the run paid', async () => {
    const batch = await call(harness, 'POST', '/bank-batches', {
      token: financeToken,
      idempotencyKey: uuidv4(),
      payload: { run_id: lockedRunId, bank_profile_id: bankProfileId, value_date: '2026-09-30' },
    });
    const batchId = batch.body['id'] as string;

    // จำลองการแก้ยอดปลายทางโดยไม่ผ่าน API
    await withTenant(harness.database.db, tenant.tenantId, async (tx) => {
      const items = await tx
        .select()
        .from(schema.bankBatchItems)
        .where(eq(schema.bankBatchItems.batchId, batchId));
      await tx
        .update(schema.bankBatchItems)
        .set({ amount: '99999.0000' })
        .where(eq(schema.bankBatchItems.id, items[0]?.id as string));
    });

    const verify = await call(harness, 'GET', `/bank-batches/${batchId}/verify`, {
      token: financeToken,
    });
    expect(verify.body['matches']).toBe(false);

    const paid = await call(harness, 'POST', `/payroll-runs/${lockedRunId}/mark-paid`, {
      token: financeToken,
      idempotencyKey: uuidv4(),
      payload: { bank_batch_id: batchId },
    });
    expect(paid.status).toBe(409);
  });

  it('never returns the destination account number', async () => {
    const batch = await call(harness, 'POST', '/bank-batches', {
      token: financeToken,
      idempotencyKey: uuidv4(),
      payload: { run_id: lockedRunId, bank_profile_id: bankProfileId, value_date: '2026-10-31' },
    });
    expect(JSON.stringify(batch.body)).not.toContain('1234567890');
  });

  it('denies bank access to a role without the export permission', async () => {
    const denied = await call(harness, 'POST', '/bank-batches', {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { run_id: lockedRunId, bank_profile_id: bankProfileId, value_date: '2026-08-31' },
    });
    expect(denied.status).toBe(403);
  });
});

describe('payroll register export', () => {
  it('produces totals equal to the sum of its rows', async () => {
    const exported = await call(harness, 'POST', `/payroll-runs/${lockedRunId}/export-jobs`, {
      token: financeToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });

    expect(exported.status).toBe(200);
    expect(exported.body['row_count']).toBe(2);

    const totals = exported.body['totals'] as Record<string, string>;
    expect(totals['gross']).toBe('48000.0000');
    expect(totals['net_pay']).toBe('46500.0000');

    // ผลรวมต้องเท่ากับ gross ลบ deduction พอดี
    expect(
      Money.of(totals['gross'] as string)
        .subtract(Money.of(totals['total_deduction'] as string))
        .toString(),
    ).toBe(totals['net_pay']);
  });

  it('records the export job with a content hash for audit', async () => {
    const jobs = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx.select().from(schema.exportJobs).where(eq(schema.exportJobs.runId, lockedRunId)),
    );

    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0]?.status).toBe('SUCCEEDED');
    expect(jobs[0]?.contentHash).toBeInstanceOf(Uint8Array);
  });
});
