import { schema, withTenant } from '@workforce/db';
import { LocalDate, uuidv4, uuidv7 } from '@workforce/domain';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createTestHarness, type TestHarness, type TestTenant } from './testing/test-app';

let harness: TestHarness;
let tenant: TestTenant;
let hrToken: string;
let adminToken: string;
let supervisorToken: string;
let dayShiftId: string;
let restShiftId: string;
let annualLeaveTypeId: string;
let unpaidLeaveTypeId: string;

interface Employee {
  employmentId: string;
  token: string;
}

async function createEmployee(name: string): Promise<Employee> {
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
      employee_code: `W-${uuidv4().slice(0, 8)}`,
      employment_type: 'MONTHLY',
      hired_on: '2026-01-01',
    },
  });
  const employmentId = employment.body['id'] as string;

  const subject = `w|${uuidv4().slice(0, 8)}`;
  await harness.createPrincipal(tenant, { subject, roles: ['EMPLOYEE'], personId });

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
      saturday_shift_id: restShiftId,
      sunday_shift_id: restShiftId,
      effective_from: '2026-01-01',
    },
  });

  return { employmentId, token: await harness.token(subject, tenant.tenantId) };
}

async function addEvent(employmentId: string, capturedAt: string, intent: string): Promise<void> {
  await withTenant(harness.database.db, tenant.tenantId, async (tx) => {
    await tx.insert(schema.rawTimeEvents).values({
      id: uuidv7(),
      tenantId: tenant.tenantId,
      companyId: tenant.companyId,
      employmentId,
      sourceType: 'MANUAL',
      eventIntent: intent,
      capturedAt: new Date(capturedAt),
      timeZone: 'Asia/Bangkok',
      payloadHash: Buffer.alloc(32),
      evidence: {},
      clientContext: {},
      status: 'ACCEPTED',
    });
  });
}

async function grantLeave(employmentId: string, leaveTypeId: string, minutes: number): Promise<void> {
  const response = await call(harness, 'POST', '/leave-balances:grant', {
    token: hrToken,
    idempotencyKey: uuidv4(),
    payload: {
      employment_id: employmentId,
      leave_type_id: leaveTypeId,
      period_year: 2026,
      minutes,
      reason: 'สิทธิ์ประจำปี 2569',
    },
  });
  expect(response.status).toBe(201);
}

beforeAll(async () => {
  harness = await createTestHarness();
  tenant = await harness.createTenant('workflow');

  await harness.createPrincipal(tenant, { subject: 'f|hr', roles: ['HR_OFFICER'] });
  await harness.createPrincipal(tenant, { subject: 'f|admin', roles: ['TENANT_ADMIN', 'HR_OFFICER'] });
  await harness.createPrincipal(tenant, { subject: 'f|sup', roles: ['SUPERVISOR'] });
  hrToken = await harness.token('f|hr', tenant.tenantId);
  adminToken = await harness.token('f|admin', tenant.tenantId);
  supervisorToken = await harness.token('f|sup', tenant.tenantId);

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

  const day = await call(harness, 'POST', '/shifts', {
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
  dayShiftId = day.body['id'] as string;

  const rest = await call(harness, 'POST', '/shifts', {
    token: adminToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      code: 'REST',
      name: 'หยุดประจำสัปดาห์',
      start: '00:00',
      end: '00:00',
      rest_day: true,
    },
  });
  restShiftId = rest.body['id'] as string;

  const annual = await call(harness, 'POST', '/leave-types', {
    token: hrToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      code: 'ANNUAL',
      name: 'ลาพักร้อน',
      paid: true,
      unit: 'HALF_DAY',
      quota_minutes_per_year: 2880,
      effective_from: '2026-01-01',
    },
  });
  annualLeaveTypeId = annual.body['id'] as string;

  const unpaid = await call(harness, 'POST', '/leave-types', {
    token: hrToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      code: 'UNPAID',
      name: 'ลาไม่รับค่าจ้าง',
      paid: false,
      unit: 'DAY',
      quota_minutes_per_year: 0,
      allow_negative: true,
      effective_from: '2026-01-01',
    },
  });
  unpaidLeaveTypeId = unpaid.body['id'] as string;
}, 180_000);

afterAll(async () => {
  await harness.close();
});

describe('leave balance ledger', () => {
  it('derives the balance from ledger entries, never from a stored total', async () => {
    const employee = await createEmployee('สิทธิ์ลา');
    await grantLeave(employee.employmentId, annualLeaveTypeId, 2880);

    const balance = await call(
      harness,
      'GET',
      `/leave-balances?employment_id=${employee.employmentId}&period_year=2026`,
      { token: hrToken },
    );

    const items = balance.body['items'] as { available_minutes: number; granted_minutes: number }[];
    expect(items[0]?.granted_minutes).toBe(2880);
    expect(items[0]?.available_minutes).toBe(2880);
  });

  it('reserves on submit and consumes only on approval', async () => {
    const employee = await createEmployee('จองสิทธิ์');
    await grantLeave(employee.employmentId, annualLeaveTypeId, 2880);

    const request = await call(harness, 'POST', '/leave-requests', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: employee.employmentId,
        leave_type_id: annualLeaveTypeId,
        starts_on: '2026-08-05',
        ends_on: '2026-08-05',
        total_minutes: 480,
        reason: 'ธุระส่วนตัว',
      },
    });
    expect(request.status).toBe(201);

    const afterSubmit = await call(
      harness,
      'GET',
      `/leave-balances?employment_id=${employee.employmentId}&period_year=2026`,
      { token: hrToken },
    );
    const reserved = (afterSubmit.body['items'] as { reserved_minutes: number; available_minutes: number }[])[0];
    expect(reserved?.reserved_minutes).toBe(480);
    expect(reserved?.available_minutes).toBe(2400);

    await call(harness, 'POST', `/leave-requests/${request.body['id'] as string}/decide`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { outcome: 'APPROVED', reason: 'อนุมัติ' },
    });

    const afterApproval = await call(
      harness,
      'GET',
      `/leave-balances?employment_id=${employee.employmentId}&period_year=2026`,
      { token: hrToken },
    );
    const consumed = (afterApproval.body['items'] as {
      reserved_minutes: number;
      consumed_minutes: number;
      available_minutes: number;
    }[])[0];
    expect(consumed?.reserved_minutes).toBe(0);
    expect(consumed?.consumed_minutes).toBe(480);
    expect(consumed?.available_minutes).toBe(2400);
  });

  it('returns the reservation when a request is rejected', async () => {
    const employee = await createEmployee('ถูกปฏิเสธ');
    await grantLeave(employee.employmentId, annualLeaveTypeId, 960);

    const request = await call(harness, 'POST', '/leave-requests', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: employee.employmentId,
        leave_type_id: annualLeaveTypeId,
        starts_on: '2026-08-05',
        ends_on: '2026-08-05',
        total_minutes: 480,
        reason: 'ขอลา',
      },
    });

    await call(harness, 'POST', `/leave-requests/${request.body['id'] as string}/decide`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { outcome: 'REJECTED', reason: 'งานเร่ง' },
    });

    const balance = await call(
      harness,
      'GET',
      `/leave-balances?employment_id=${employee.employmentId}&period_year=2026`,
      { token: hrToken },
    );
    expect((balance.body['items'] as { available_minutes: number }[])[0]?.available_minutes).toBe(960);
  });

  it('reverses an approved leave on cancellation without deleting history', async () => {
    const employee = await createEmployee('ยกเลิก');
    await grantLeave(employee.employmentId, annualLeaveTypeId, 960);

    const request = await call(harness, 'POST', '/leave-requests', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: employee.employmentId,
        leave_type_id: annualLeaveTypeId,
        starts_on: '2026-08-05',
        ends_on: '2026-08-05',
        total_minutes: 480,
        reason: 'ขอลา',
      },
    });
    const requestId = request.body['id'] as string;

    await call(harness, 'POST', `/leave-requests/${requestId}/decide`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { outcome: 'APPROVED', reason: 'อนุมัติ' },
    });
    await call(harness, 'POST', `/leave-requests/${requestId}/cancel`, {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { reason: 'ไม่ได้ใช้วันลา' },
    });

    const balance = await call(
      harness,
      'GET',
      `/leave-balances?employment_id=${employee.employmentId}&period_year=2026`,
      { token: hrToken },
    );
    expect((balance.body['items'] as { available_minutes: number }[])[0]?.available_minutes).toBe(960);

    // ประวัติทุกรายการยังอยู่ — ยอดคงเหลือคือผลรวม ไม่ใช่ตัวเลขที่ถูกเขียนทับ
    const entries = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.leaveBalanceLedger)
        .where(eq(schema.leaveBalanceLedger.employmentId, employee.employmentId)),
    );
    expect(entries.map((entry) => entry.entryType).sort()).toEqual([
      'CONSUME',
      'OPENING',
      'RELEASE',
      'RESERVE',
      'REVERSAL',
    ]);
  });

  it('refuses a request with insufficient balance', async () => {
    const employee = await createEmployee('สิทธิ์ไม่พอ');
    await grantLeave(employee.employmentId, annualLeaveTypeId, 240);

    const response = await call(harness, 'POST', '/leave-requests', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: employee.employmentId,
        leave_type_id: annualLeaveTypeId,
        starts_on: '2026-08-05',
        ends_on: '2026-08-05',
        total_minutes: 480,
        reason: 'ขอลา',
      },
    });
    expect(response.status).toBe(400);
    expect(response.body['meta']).toMatchObject({ available_minutes: 240 });
  });

  it('allows unpaid leave to go negative when the type permits it', async () => {
    const employee = await createEmployee('ลาไม่รับค่าจ้าง');
    const response = await call(harness, 'POST', '/leave-requests', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: employee.employmentId,
        leave_type_id: unpaidLeaveTypeId,
        starts_on: '2026-08-05',
        ends_on: '2026-08-05',
        total_minutes: 480,
        reason: 'ธุระจำเป็น',
      },
    });
    expect(response.status).toBe(201);
  });

  it('rejects any attempt to modify a ledger entry', async () => {
    const employee = await createEmployee('แก้ ledger');
    await grantLeave(employee.employmentId, annualLeaveTypeId, 480);

    await expect(
      withTenant(harness.database.db, tenant.tenantId, async (tx) => {
        await tx
          .update(schema.leaveBalanceLedger)
          .set({ minutes: 99_999 })
          .where(eq(schema.leaveBalanceLedger.employmentId, employee.employmentId));
      }),
    ).rejects.toThrow();
  });
});

describe('leave and attendance', () => {
  it('stops an approved leave day from counting as absence', async () => {
    const employee = await createEmployee('ลาแล้วไม่ขาด');
    await grantLeave(employee.employmentId, annualLeaveTypeId, 2880);

    const request = await call(harness, 'POST', '/leave-requests', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: employee.employmentId,
        leave_type_id: annualLeaveTypeId,
        starts_on: '2026-08-05',
        ends_on: '2026-08-05',
        total_minutes: 480,
        reason: 'ลาพักร้อน',
      },
    });
    await call(harness, 'POST', `/leave-requests/${request.body['id'] as string}/decide`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { outcome: 'APPROVED', reason: 'อนุมัติ' },
    });

    await call(harness, 'POST', '/attendance-results:recalculate', {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { employment_id: employee.employmentId, from: '2026-08-05', to: '2026-08-05' },
    });

    const results = await call(
      harness,
      'GET',
      `/attendance-results?employment_id=${employee.employmentId}&from=2026-08-05&to=2026-08-05`,
      { token: hrToken },
    );
    const day = (results.body['items'] as Record<string, unknown>[])[0];

    expect(day?.['is_on_leave']).toBe(true);
    expect(day?.['absence_minutes']).toBe(0);
    expect(day?.['paid_minutes']).toBe(480);
  });
});

describe('overtime', () => {
  it('caps approved minutes at min(planned, actual)', async () => {
    const employee = await createEmployee('โอที');

    const request = await call(harness, 'POST', '/overtime-requests', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: employee.employmentId,
        work_date: '2026-08-06',
        ot_category: 'WORKDAY',
        planned_minutes: 120,
        reason: 'ปิดงบเดือน',
      },
    });
    const requestId = request.body['id'] as string;

    await call(harness, 'POST', `/overtime-requests/${requestId}/pre-approve`, {
      token: supervisorToken,
      idempotencyKey: uuidv4(),
      payload: { reason: 'อนุมัติล่วงหน้า' },
    });

    // ทำจริง 180 นาที แต่ขออนุมัติไว้ 120 → eligible = 120 (spec §8.3)
    const approved = await call(harness, 'POST', `/overtime-requests/${requestId}/final-approve`, {
      token: supervisorToken,
      idempotencyKey: uuidv4(),
      payload: { actual_minutes: 180, approved_minutes: null, reason: 'ยืนยันเวลาจริง' },
    });

    expect(approved.body['eligible_minutes']).toBe(120);
    expect(approved.body['approved_minutes']).toBe(120);
  });

  it('refuses to approve more than the eligible minutes', async () => {
    const employee = await createEmployee('โอทีเกิน');
    const request = await call(harness, 'POST', '/overtime-requests', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: employee.employmentId,
        work_date: '2026-08-06',
        planned_minutes: 60,
        reason: 'งานด่วน',
      },
    });

    const response = await call(
      harness,
      'POST',
      `/overtime-requests/${request.body['id'] as string}/final-approve`,
      {
        token: supervisorToken,
        idempotencyKey: uuidv4(),
        payload: { actual_minutes: 60, approved_minutes: 240, reason: 'ขอจ่ายเพิ่ม' },
      },
    );
    expect(response.status).toBe(400);
  });

  it('refuses self-approval', async () => {
    const employee = await createEmployee('อนุมัติเอง');
    const request = await call(harness, 'POST', '/overtime-requests', {
      token: supervisorToken,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: employee.employmentId,
        work_date: '2026-08-07',
        planned_minutes: 60,
        reason: 'งานด่วน',
      },
    });

    const response = await call(
      harness,
      'POST',
      `/overtime-requests/${request.body['id'] as string}/pre-approve`,
      { token: supervisorToken, idempotencyKey: uuidv4(), payload: { reason: 'อนุมัติเอง' } },
    );
    expect(response.status).toBe(403);
  });
});

describe('timesheet close', () => {
  // หนึ่งงวดต่อบริษัทต่อช่วงวันที่ — เลื่อนวันเริ่มถอยหลังให้แต่ละ test มีงวดของตัวเอง
  // โดยยังครอบวันที่ 2026-08-03 ที่ใช้ทดสอบไว้เสมอ
  let periodOffset = 0;

  async function createPeriod(): Promise<string> {
    periodOffset += 1;
    const startsOn = LocalDate.parse('2026-08-03').minusDays(periodOffset * 7).toString();

    const response = await call(harness, 'POST', '/timesheet-periods', {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: {
        company_id: tenant.companyId,
        name: `งวด ${uuidv4().slice(0, 6)}`,
        starts_on: startsOn,
        ends_on: '2026-08-09',
      },
    });
    expect(response.status).toBe(201);
    return response.body['id'] as string;
  }

  it('builds the snapshot on the server from attendance results', async () => {
    // ระบบเดิมรับตัวเลขจาก browser (spec §3.3 P3)
    const employee = await createEmployee('ปิดงวด');
    await addEvent(employee.employmentId, '2026-08-03T01:00:00Z', 'CLOCK_IN');
    await addEvent(employee.employmentId, '2026-08-03T10:00:00Z', 'CLOCK_OUT');

    await call(harness, 'POST', '/attendance-results:recalculate', {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { employment_id: employee.employmentId, from: '2026-08-03', to: '2026-08-03' },
    });

    const periodId = await createPeriod();
    const generated = await call(harness, 'POST', `/timesheet-periods/${periodId}/generate`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
    expect(generated.status).toBe(200);

    const sheets = await call(harness, 'GET', `/timesheet-periods/${periodId}/timesheets`, {
      token: hrToken,
    });
    const mine = (sheets.body['items'] as Record<string, unknown>[]).find(
      (item) => item['employment_id'] === employee.employmentId,
    );

    expect(mine?.['worked_minutes']).toBe(480);
    expect(mine?.['worked_days']).toBe(1);
    expect(mine?.['blocking_exception_count']).toBe(0);
  });

  it('blocks closing while a blocking exception is open', async () => {
    const employee = await createEmployee('ยังไม่ครบ');
    await addEvent(employee.employmentId, '2026-08-03T01:00:00Z', 'CLOCK_IN');

    await call(harness, 'POST', '/attendance-results:recalculate', {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { employment_id: employee.employmentId, from: '2026-08-03', to: '2026-08-03' },
    });

    const periodId = await createPeriod();
    await call(harness, 'POST', `/timesheet-periods/${periodId}/generate`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });

    const blocked = await call(harness, 'POST', `/timesheet-periods/${periodId}/close`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { force: false, reason: '' },
    });
    // spec §10.2: missing punch ที่ยังไม่แก้ต้องกันการปิดงวด
    expect(blocked.status).toBe(409);

    const forced = await call(harness, 'POST', `/timesheet-periods/${periodId}/close`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { force: true, reason: 'พนักงานลาออกแล้ว เก็บเวลาออกไม่ได้' },
    });
    expect(forced.status).toBe(200);
  });

  it('freezes day snapshots once the period is closed', async () => {
    const employee = await createEmployee('แช่แข็ง');
    await addEvent(employee.employmentId, '2026-08-03T01:00:00Z', 'CLOCK_IN');
    await addEvent(employee.employmentId, '2026-08-03T10:00:00Z', 'CLOCK_OUT');
    await call(harness, 'POST', '/attendance-results:recalculate', {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { employment_id: employee.employmentId, from: '2026-08-03', to: '2026-08-03' },
    });

    const periodId = await createPeriod();
    await call(harness, 'POST', `/timesheet-periods/${periodId}/generate`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
    const closed = await call(harness, 'POST', `/timesheet-periods/${periodId}/close`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { force: true, reason: 'ปิดงวดทดสอบ' },
    });
    expect(closed.status).toBe(200);

    // regenerate ต้องถูกปฏิเสธ — payroll ต้องอ่านตัวเลขเดิมได้เสมอ
    const regenerate = await call(harness, 'POST', `/timesheet-periods/${periodId}/generate`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
    expect(regenerate.status).toBe(409);

    // แม้เขียนตรงเข้า DB ก็ต้องถูก trigger ปฏิเสธ
    // ต้องเจาะจง timesheet ของพนักงานคนนี้ — คนอื่นในบริษัทไม่มี snapshot รายวัน
    // การ UPDATE ที่ไม่ตรงแถวไหนเลยจะไม่ปลุก trigger และทำให้ test ผ่านแบบหลอก ๆ
    const timesheets = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.timesheets)
        .where(
          and(
            eq(schema.timesheets.periodId, periodId),
            eq(schema.timesheets.employmentId, employee.employmentId),
          ),
        ),
    );
    const timesheetId = timesheets[0]?.id as string;
    expect(timesheetId).toBeTruthy();

    const snapshots = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.timesheetDaySnapshots)
        .where(eq(schema.timesheetDaySnapshots.timesheetId, timesheetId)),
    );
    expect(snapshots.length).toBeGreaterThan(0);

    await expect(
      withTenant(harness.database.db, tenant.tenantId, async (tx) => {
        await tx
          .update(schema.timesheetDaySnapshots)
          .set({ workedMinutes: 9999 })
          .where(eq(schema.timesheetDaySnapshots.timesheetId, timesheetId));
      }),
    ).rejects.toThrow();
  });

  it('requires a reason to reopen a closed period', async () => {
    const periodId = await createPeriod();
    await call(harness, 'POST', `/timesheet-periods/${periodId}/generate`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
    await call(harness, 'POST', `/timesheet-periods/${periodId}/close`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { force: true, reason: 'ปิดงวด' },
    });

    const noReason = await call(harness, 'POST', `/timesheet-periods/${periodId}/reopen`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { reason: '' },
    });
    expect(noReason.status).toBe(400);

    const reopened = await call(harness, 'POST', `/timesheet-periods/${periodId}/reopen`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { reason: 'พบเวลาที่บันทึกผิดหลังปิดงวด' },
    });
    expect(reopened.status).toBe(200);
    expect(reopened.body['status']).toBe('REOPENED');
  });
});
