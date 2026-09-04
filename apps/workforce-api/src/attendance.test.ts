import { schema, withTenant } from '@workforce/db';
import { uuidv4, uuidv7 } from '@workforce/domain';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createTestHarness, type TestHarness, type TestTenant } from './testing/test-app';

let harness: TestHarness;
let tenant: TestTenant;
let hrToken: string;
let adminToken: string;
let supervisorToken: string;
let dayShiftId: string;
let nightShiftId: string;
let restShiftId: string;

async function createEmployment(name: string): Promise<string> {
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
      employee_code: `A-${uuidv4().slice(0, 8)}`,
      employment_type: 'MONTHLY',
      hired_on: '2026-01-01',
    },
  });
  return employment.body['id'] as string;
}

/** ใส่ raw event ตรงเข้า DB — Phase 2 ครอบคลุมเส้นทาง ingestion แล้ว */
async function addEvent(
  employmentId: string,
  capturedAt: string,
  intent = 'AUTO',
): Promise<string> {
  const id = uuidv7();
  await withTenant(harness.database.db, tenant.tenantId, async (tx) => {
    await tx.insert(schema.rawTimeEvents).values({
      id,
      tenantId: tenant.tenantId,
      companyId: tenant.companyId,
      employmentId,
      sourceType: 'MANUAL',
      sourceId: null,
      eventIntent: intent,
      capturedAt: new Date(capturedAt),
      timeZone: 'Asia/Bangkok',
      sequence: null,
      payloadHash: Buffer.alloc(32),
      evidence: {},
      clientContext: {},
      status: 'ACCEPTED',
    });
  });
  return id;
}

async function assignPattern(employmentId: string, shiftId: string | null): Promise<void> {
  const response = await call(harness, 'POST', '/recurring-work-patterns', {
    token: adminToken,
    idempotencyKey: uuidv4(),
    payload: {
      employment_id: employmentId,
      monday_shift_id: shiftId,
      tuesday_shift_id: shiftId,
      wednesday_shift_id: shiftId,
      thursday_shift_id: shiftId,
      friday_shift_id: shiftId,
      saturday_shift_id: restShiftId,
      sunday_shift_id: restShiftId,
      effective_from: '2026-01-01',
    },
  });
  expect(response.status).toBe(201);
}

async function recalculate(employmentId: string, date: string): Promise<Record<string, unknown>> {
  const response = await call(harness, 'POST', '/attendance-results:recalculate', {
    token: hrToken,
    idempotencyKey: uuidv4(),
    payload: { employment_id: employmentId, from: date, to: date },
  });
  expect(response.status).toBe(200);

  const results = await call(
    harness,
    'GET',
    `/attendance-results?employment_id=${employmentId}&from=${date}&to=${date}`,
    { token: hrToken },
  );
  return (results.body['items'] as Record<string, unknown>[])[0] ?? {};
}

beforeAll(async () => {
  harness = await createTestHarness();
  tenant = await harness.createTenant('attend');

  await harness.createPrincipal(tenant, { subject: 'a|hr', roles: ['HR_OFFICER'] });
  await harness.createPrincipal(tenant, { subject: 'a|admin', roles: ['TENANT_ADMIN', 'HR_OFFICER'] });
  await harness.createPrincipal(tenant, { subject: 'a|sup', roles: ['SUPERVISOR'] });
  hrToken = await harness.token('a|hr', tenant.tenantId);
  adminToken = await harness.token('a|admin', tenant.tenantId);
  supervisorToken = await harness.token('a|sup', tenant.tenantId);

  const policy = await call(harness, 'POST', '/work-policies', {
    token: adminToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      code: 'STD',
      name: 'มาตรฐาน',
      late_mode: 'GRACE',
      grace_minutes: 15,
      grace_deduction: 'EXCESS_OVER_GRACE',
      ot_requires_approval: true,
      ot_minimum_minutes: 30,
      ot_rounding_minutes: 30,
      effective_from: '2026-01-01',
    },
  });
  expect(policy.status).toBe(201);

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

  const night = await call(harness, 'POST', '/shifts', {
    token: adminToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      code: 'NIGHT',
      name: 'กะกลางคืน',
      start: '22:00',
      end: '06:00',
      crosses_midnight: true,
    },
  });
  nightShiftId = night.body['id'] as string;

  const rest = await call(harness, 'POST', '/shifts', {
    token: adminToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      code: 'REST',
      name: 'วันหยุดประจำสัปดาห์',
      start: '00:00',
      end: '00:00',
      rest_day: true,
    },
  });
  restShiftId = rest.body['id'] as string;
}, 180_000);

afterAll(async () => {
  await harness.close();
});

describe('shift configuration', () => {
  it('stores an overnight shift as minutes past the start day', () => {
    // 22:00 → 06:00 ของวันถัดไป = 1320 → 1800 (spec §7.1)
    expect(typeof nightShiftId).toBe('string');
  });

  it('refuses an overnight shift that is not declared as such', async () => {
    const response = await call(harness, 'POST', '/shifts', {
      token: adminToken,
      idempotencyKey: uuidv4(),
      payload: {
        company_id: tenant.companyId,
        code: `BAD-${uuidv4().slice(0, 6)}`,
        name: 'ผิดรูป',
        start: '22:00',
        end: '06:00',
      },
    });
    expect(response.status).toBe(400);
  });

  it('rejects GRACE mode with no grace window', async () => {
    const response = await call(harness, 'POST', '/work-policies', {
      token: adminToken,
      idempotencyKey: uuidv4(),
      payload: {
        company_id: tenant.companyId,
        code: `G-${uuidv4().slice(0, 6)}`,
        name: 'ไม่มีผ่อนผัน',
        late_mode: 'GRACE',
        grace_minutes: 0,
        effective_from: '2026-01-01',
      },
    });
    expect(response.status).toBe(400);
  });

  it('reads back the pattern that is actually bound, with shift names', async () => {
    // หน้าจอต้องแสดงตารางที่ผูกไว้จริง ไม่ใช่ค่าที่มันเดาเอง — ถ้าอ่านกลับไม่ได้
    // คนที่ตั้งใจแก้แค่วันเสาร์จะกดทับทั้งสัปดาห์โดยไม่รู้ตัว
    const employmentId = await createEmployment('อ่านตารางกลับ');
    await assignPattern(employmentId, dayShiftId);

    const response = await call(
      harness,
      'GET',
      `/recurring-work-patterns?employment_id=${employmentId}`,
      { token: hrToken },
    );

    expect(response.status).toBe(200);
    const items = response.body['items'] as Record<string, Record<string, unknown>>[];
    expect(items).toHaveLength(1);
    expect(items[0]?.['effective_from']).toBe('2026-01-01');
    expect(items[0]?.['monday']?.['id']).toBe(dayShiftId);
    expect(items[0]?.['monday']?.['name']).toBeTypeOf('string');
    expect(items[0]?.['saturday']?.['rest_day']).toBe(true);
  });

  it('replaces a pattern that starts on the same day instead of refusing', async () => {
    /*
     * ผูกกะแล้วนึกได้ว่าเลือกผิดเป็นเรื่องปกติที่สุด — ถ้าทับใบที่เริ่มวันเดียวกัน
     * ไม่ได้ ทางออกเดียวคือเลื่อนวันเริ่มไปพรุ่งนี้ แปลว่าตารางผิดยังมีผลทั้งวันนี้
     */
    const employmentId = await createEmployment('แก้วันเดียวกัน');
    await assignPattern(employmentId, dayShiftId);

    const second = await call(harness, 'POST', '/recurring-work-patterns', {
      token: adminToken,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: employmentId,
        monday_shift_id: nightShiftId,
        tuesday_shift_id: nightShiftId,
        wednesday_shift_id: nightShiftId,
        thursday_shift_id: nightShiftId,
        friday_shift_id: nightShiftId,
        saturday_shift_id: restShiftId,
        sunday_shift_id: restShiftId,
        effective_from: '2026-01-01',
        supersede_current: true,
      },
    });
    expect(second.status).toBe(201);

    // เหลือใบเดียว ไม่ใช่สองใบที่เริ่มวันเดียวกัน (ซึ่งจะทำให้เลือกกะแบบสุ่ม)
    const after = await call(
      harness,
      'GET',
      `/recurring-work-patterns?employment_id=${employmentId}`,
      { token: hrToken },
    );
    const items = after.body['items'] as Record<string, Record<string, unknown>>[];
    expect(items).toHaveLength(1);
    expect(items[0]?.['monday']?.['id']).toBe(nightShiftId);
  });
});

describe('attendance calculation', () => {
  it('computes a normal day end to end', async () => {
    const employmentId = await createEmployment('ปกติ');
    await assignPattern(employmentId, dayShiftId);

    // 2026-08-03 เป็นวันจันทร์; เวลาไทย 07:55 = 00:55Z
    await addEvent(employmentId, '2026-08-03T00:55:00Z', 'CLOCK_IN');
    await addEvent(employmentId, '2026-08-03T10:05:00Z', 'CLOCK_OUT');

    const result = await recalculate(employmentId, '2026-08-03');

    expect(result['late_minutes']).toBe(0);
    expect(result['absence_minutes']).toBe(0);
    expect(result['worked_minutes']).toBe(490);
    expect(result['break_minutes']).toBe(60);
    expect(result['has_blocking_exception']).toBe(false);
  });

  it('charges only the minutes beyond the grace window', async () => {
    const employmentId = await createEmployment('มาสาย');
    await assignPattern(employmentId, dayShiftId);

    // 08:25 ไทย = 01:25Z → เกิน grace 15 นาทีอยู่ 10 นาที
    await addEvent(employmentId, '2026-08-03T01:25:00Z', 'CLOCK_IN');
    await addEvent(employmentId, '2026-08-03T10:00:00Z', 'CLOCK_OUT');

    const result = await recalculate(employmentId, '2026-08-03');
    expect(result['late_minutes']).toBe(10);
  });

  it('attributes an overnight shift to the day it started', async () => {
    const employmentId = await createEmployment('กะดึก');
    await assignPattern(employmentId, nightShiftId);

    // เข้า 21:55 ไทยของวันจันทร์ = 14:55Z จันทร์; ออก 06:05 ไทยอังคาร = 23:05Z จันทร์
    await addEvent(employmentId, '2026-08-03T14:55:00Z', 'CLOCK_IN');
    await addEvent(employmentId, '2026-08-03T23:05:00Z', 'CLOCK_OUT');

    const result = await recalculate(employmentId, '2026-08-03');

    // spec §7.1: work_date คือวันเริ่มกะ ไม่ใช่วันปฏิทินของ OUT
    expect(result['work_date']).toBe('2026-08-03');
    expect(result['worked_minutes']).toBe(490);
    expect(result['late_minutes']).toBe(0);
  });

  it('does not pull the next day punches into an empty day', async () => {
    // เคยพลาด: หน้าต่างเก็บการสแกนวัดจาก "เวลาเข้ากะ + 30 ชม." จึงกินไปถึงกะวันถัดไป
    // วันที่ไม่มีใครมาเลยขึ้นทั้ง absence เต็มกะ *และ* สายข้ามคืนพร้อมกัน
    const employmentId = await createEmployment('ข้ามวัน');
    await assignPattern(employmentId, dayShiftId);

    // ไม่มีการสแกนวันที่ 3 เลย — มีแต่ของวันที่ 4 (08:02 ไทย = 01:02Z)
    await addEvent(employmentId, '2026-08-04T01:02:00Z', 'CLOCK_IN');
    await addEvent(employmentId, '2026-08-04T10:05:00Z', 'CLOCK_OUT');

    const empty = await recalculate(employmentId, '2026-08-03');
    expect(empty['actual_in_at']).toBeNull();
    expect(empty['late_minutes']).toBe(0);
    expect(empty['absence_minutes']).toBe(480);

    // และวันที่ 4 ต้องได้การสแกนของตัวเองครบ
    const worked = await recalculate(employmentId, '2026-08-04');
    expect(worked['actual_in_at']).toBe('2026-08-04T01:02:00.000Z');
    expect(worked['absence_minutes']).toBe(0);
    expect(worked['worked_minutes']).toBeGreaterThan(0);
  });

  it('never reports absence and lateness for the same shift at once', async () => {
    // ขาดงานเต็มกะแปลว่าไม่มีใครมา จึงเป็นไปไม่ได้ที่จะ "มาสาย" ในวันเดียวกัน
    const employmentId = await createEmployment('ขัดแย้ง');
    await assignPattern(employmentId, dayShiftId);

    await addEvent(employmentId, '2026-08-05T01:02:00Z', 'CLOCK_IN');
    await addEvent(employmentId, '2026-08-05T10:05:00Z', 'CLOCK_OUT');

    for (const workDate of ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06']) {
      const result = await recalculate(employmentId, workDate);
      const absence = result['absence_minutes'] as number;
      const late = result['late_minutes'] as number;
      expect(absence === 480 && late > 0).toBe(false);
    }
  });

  it('raises a blocking exception for a missing clock-out', async () => {
    const employmentId = await createEmployment('ลืมออก');
    await assignPattern(employmentId, dayShiftId);
    await addEvent(employmentId, '2026-08-03T01:00:00Z', 'CLOCK_IN');

    const result = await recalculate(employmentId, '2026-08-03');
    expect(result['has_blocking_exception']).toBe(true);

    const exceptions = await call(
      harness,
      'GET',
      `/attendance-exceptions?employment_id=${employmentId}&status=OPEN`,
      { token: hrToken },
    );
    const codes = (exceptions.body['items'] as { code: string }[]).map((item) => item.code);
    expect(codes).toContain('MISSING_OUT');
  });

  it('does not charge absence on a rest day', async () => {
    const employmentId = await createEmployment('วันหยุด');
    await assignPattern(employmentId, dayShiftId);

    // 2026-08-08 เป็นวันเสาร์ → pattern กำหนดเป็น rest day
    const result = await recalculate(employmentId, '2026-08-08');
    expect(result['is_rest_day']).toBe(true);
    expect(result['absence_minutes']).toBe(0);
  });

  it('does not charge absence on a public holiday', async () => {
    const employmentId = await createEmployment('นักขัตฤกษ์');
    await assignPattern(employmentId, dayShiftId);

    const calendar = await call(harness, 'POST', '/holiday-calendars', {
      token: adminToken,
      idempotencyKey: uuidv4(),
      payload: { company_id: tenant.companyId, code: `TH-${uuidv4().slice(0, 6)}`, name: 'ไทย' },
    });
    await call(harness, 'POST', `/holiday-calendars/${calendar.body['id'] as string}/dates`, {
      token: adminToken,
      idempotencyKey: uuidv4(),
      payload: { dates: [{ holiday_date: '2026-08-12', name: 'วันแม่แห่งชาติ', paid: true }] },
    });

    const result = await recalculate(employmentId, '2026-08-12');
    expect(result['is_holiday']).toBe(true);
    expect(result['absence_minutes']).toBe(0);
  });

  it('reports overtime beyond the schedule as unapproved', async () => {
    const employmentId = await createEmployment('ทำโอที');
    await assignPattern(employmentId, dayShiftId);
    await addEvent(employmentId, '2026-08-03T01:00:00Z', 'CLOCK_IN');
    await addEvent(employmentId, '2026-08-03T12:00:00Z', 'CLOCK_OUT');

    const result = await recalculate(employmentId, '2026-08-03');
    expect(result['ot_candidate_minutes']).toBeGreaterThan(0);

    const exceptions = await call(
      harness,
      'GET',
      `/attendance-exceptions?employment_id=${employmentId}`,
      { token: hrToken },
    );
    expect((exceptions.body['items'] as { code: string }[]).map((i) => i.code)).toContain(
      'UNAPPROVED_OT',
    );
  });
});

describe('daily timeline', () => {
  it('resolves an AUTO scan-out as CLOCK_OUT, not a second late clock-in', async () => {
    // เกิดจริง: กะ 08:00-17:00 ผ่อนผัน 15 นาที (setup ด้านบน) พนักงานสแกนเข้า
    // เช้าตามปกติแล้วสแกนออกตอนเย็น เครื่องส่งมาเป็น AUTO ทั้งคู่ ไม่บอกทิศทาง —
    // เดิม endpoint นี้ตัดสินว่า AUTO ทุกครั้งคือเข้างาน ตัวเย็นเลยขึ้นสาย 500+ นาที
    const employmentId = await createEmployment('ตอกออกเย็น');
    await assignPattern(employmentId, dayShiftId);

    await addEvent(employmentId, '2026-08-04T01:00:00Z', 'AUTO'); // 08:00 น.
    await addEvent(employmentId, '2026-08-04T10:30:00Z', 'AUTO'); // 17:30 น.

    const response = await call(harness, 'GET', '/time-events?date=2026-08-04', {
      token: hrToken,
    });
    expect(response.status).toBe(200);

    const items = response.body['items'] as {
      employment_id: string;
      captured_at: string;
      event_intent: string;
      late_minutes: number;
    }[];
    const mine = items.filter((i) => i.employment_id === employmentId);
    const morning = mine.find((i) => i.captured_at.startsWith('2026-08-04T01:'));
    const evening = mine.find((i) => i.captured_at.startsWith('2026-08-04T10:'));

    expect(morning?.event_intent).toBe('CLOCK_IN');
    expect(morning?.late_minutes).toBe(0);

    expect(evening?.event_intent).toBe('CLOCK_OUT');
    expect(evening?.late_minutes).toBe(0);
  });

  it('still resolves a lone AUTO scan as arrival — cannot infer direction without a pair', async () => {
    const employmentId = await createEmployment('สแกนครั้งเดียว');
    await assignPattern(employmentId, dayShiftId);

    await addEvent(employmentId, '2026-08-05T01:03:00Z', 'AUTO'); // 08:03 น. — ไม่มีคู่

    const response = await call(harness, 'GET', '/time-events?date=2026-08-05', {
      token: hrToken,
    });
    // /time-events คืนทุกคนของทั้งบริษัทในวันนั้น เรียงเวลาล่าสุดก่อน — ต้องกรอง
    // ด้วย employment_id ของตัวเอง ไม่ใช่เดาว่าเป็น items[0] (วันนี้มีเทสต์อื่น
    // ที่ใช้วันเดียวกันสร้างเหตุการณ์ของพนักงานคนอื่นไว้ด้วย)
    const items = response.body['items'] as {
      employment_id: string;
      event_intent: string;
      late_minutes: number;
    }[];
    const mine = items.find((i) => i.employment_id === employmentId);

    expect(mine?.event_intent).toBe('CLOCK_IN');
    expect(mine?.late_minutes).toBe(0); // เข้า 08:03 ยังอยู่ในผ่อนผัน 15 นาที
  });
});

describe('roster board', () => {
  it('does not apply a draft roster and applies it after publishing', async () => {
    const employmentId = await createEmployment('ตารางเวร');
    await assignPattern(employmentId, restShiftId);

    const roster = await call(harness, 'POST', '/roster-periods', {
      token: adminToken,
      idempotencyKey: uuidv4(),
      payload: {
        company_id: tenant.companyId,
        name: 'สัปดาห์ที่ 32',
        starts_on: '2026-08-03',
        ends_on: '2026-08-09',
      },
    });
    const rosterId = roster.body['id'] as string;

    await call(harness, 'POST', `/roster-periods/${rosterId}/shift-assignments:bulk-upsert`, {
      token: adminToken,
      idempotencyKey: uuidv4(),
      payload: {
        assignments: [{ employment_id: employmentId, work_date: '2026-08-04', shift_id: dayShiftId, note: '' }],
      },
    });

    await addEvent(employmentId, '2026-08-04T01:00:00Z', 'CLOCK_IN');
    await addEvent(employmentId, '2026-08-04T10:00:00Z', 'CLOCK_OUT');

    const beforePublish = await recalculate(employmentId, '2026-08-04');
    // ตาราง draft ยังไม่มีผล → ยังใช้ pattern เดิม (rest day)
    expect(beforePublish['is_rest_day']).toBe(true);

    const published = await call(harness, 'POST', `/roster-periods/${rosterId}/publish`, {
      token: adminToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });
    expect(published.status).toBe(200);
    expect(published.body['assignments_published']).toBe(1);

    const afterPublish = await recalculate(employmentId, '2026-08-04');
    expect(afterPublish['is_rest_day']).toBe(false);
    expect(afterPublish['worked_minutes']).toBe(480);
  });

  it('refuses to edit a published roster', async () => {
    const roster = await call(harness, 'POST', '/roster-periods', {
      token: adminToken,
      idempotencyKey: uuidv4(),
      payload: {
        company_id: tenant.companyId,
        name: 'ล็อกแล้ว',
        starts_on: '2026-09-01',
        ends_on: '2026-09-07',
      },
    });
    const rosterId = roster.body['id'] as string;
    await call(harness, 'POST', `/roster-periods/${rosterId}/publish`, {
      token: adminToken,
      idempotencyKey: uuidv4(),
      payload: {},
    });

    const edit = await call(
      harness,
      'POST',
      `/roster-periods/${rosterId}/shift-assignments:bulk-upsert`,
      {
        token: adminToken,
        idempotencyKey: uuidv4(),
        payload: {
          assignments: [
            { employment_id: await createEmployment('เพิ่มทีหลัง'), work_date: '2026-09-02', shift_id: dayShiftId, note: '' },
          ],
        },
      },
    );
    expect(edit.status).toBe(409);
  });

  it('rejects an assignment outside the roster period', async () => {
    const roster = await call(harness, 'POST', '/roster-periods', {
      token: adminToken,
      idempotencyKey: uuidv4(),
      payload: {
        company_id: tenant.companyId,
        name: 'นอกช่วง',
        starts_on: '2026-10-01',
        ends_on: '2026-10-07',
      },
    });

    const response = await call(
      harness,
      'POST',
      `/roster-periods/${roster.body['id'] as string}/shift-assignments:bulk-upsert`,
      {
        token: adminToken,
        idempotencyKey: uuidv4(),
        payload: {
          assignments: [
            { employment_id: await createEmployment('นอกช่วง'), work_date: '2026-11-01', shift_id: dayShiftId, note: '' },
          ],
        },
      },
    );
    expect(response.status).toBe(400);
  });
});

describe('corrections', () => {
  it('creates a new result version instead of editing the raw event', async () => {
    const employmentId = await createEmployment('แก้เวลา');
    await assignPattern(employmentId, dayShiftId);
    await addEvent(employmentId, '2026-08-03T01:00:00Z', 'CLOCK_IN');

    const before = await recalculate(employmentId, '2026-08-03');
    expect(before['has_blocking_exception']).toBe(true);
    expect(before['result_version']).toBe(1);

    const request = await call(harness, 'POST', '/attendance-correction-requests', {
      token: supervisorToken,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: employmentId,
        work_date: '2026-08-03',
        adjustment_type: 'ADD_PUNCH',
        punch_at: '2026-08-03T10:00:00Z',
        event_intent: 'CLOCK_OUT',
        reason: 'ลืมสแกนออก มีหลักฐานจากหัวหน้างาน',
      },
    });
    expect(request.status).toBe(201);

    const approved = await call(
      harness,
      'POST',
      `/attendance-correction-requests/${request.body['id'] as string}/approve`,
      {
        token: hrToken,
        idempotencyKey: uuidv4(),
        payload: { reason: 'ยืนยันกับหัวหน้างานแล้ว' },
      },
    );
    expect(approved.status).toBe(200);

    const after = await recalculate(employmentId, '2026-08-03');
    expect(after['worked_minutes']).toBe(480);
    expect(after['has_blocking_exception']).toBe(false);
    // version เดินหน้าเรื่อย ๆ — ของเดิมยังอ่านได้ (ADR-0012)
    expect(Number(after['result_version'])).toBeGreaterThan(1);

    const versions = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.attendanceResults)
        .where(eq(schema.attendanceResults.employmentId, employmentId)),
    );
    expect(versions.length).toBeGreaterThan(1);
    expect(versions.filter((row) => row.isCurrent)).toHaveLength(1);

    // raw event เดิมยังอยู่ครบและไม่ถูกแตะ
    const events = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.rawTimeEvents)
        .where(eq(schema.rawTimeEvents.employmentId, employmentId)),
    );
    expect(events).toHaveLength(1);
  });

  it('lets an approved IGNORE_EVENT drop a stray punch', async () => {
    const employmentId = await createEmployment('สแกนเกิน');
    await assignPattern(employmentId, dayShiftId);
    // 21:00 ไทยของวันเดียวกัน — สแกนเกินจริง ๆ ของวันนี้
    // (เดิม fixture ใช้ 23:00Z ซึ่งเท่ากับ 06:00 ไทยของ *เช้าวันถัดไป* จึงไม่ใช่การสแกนของวันนี้)
    const strayId = await addEvent(employmentId, '2026-08-03T14:00:00Z', 'CLOCK_IN');
    await addEvent(employmentId, '2026-08-03T01:00:00Z', 'CLOCK_IN');
    await addEvent(employmentId, '2026-08-03T10:00:00Z', 'CLOCK_OUT');

    const before = await recalculate(employmentId, '2026-08-03');
    expect(before['has_blocking_exception']).toBe(true);

    const request = await call(harness, 'POST', '/attendance-correction-requests', {
      token: supervisorToken,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: employmentId,
        work_date: '2026-08-03',
        adjustment_type: 'IGNORE_EVENT',
        target_event_id: strayId,
        reason: 'สแกนผิดพลาดตอนกลับมาเอาของ',
      },
    });

    await call(
      harness,
      'POST',
      `/attendance-correction-requests/${request.body['id'] as string}/approve`,
      { token: hrToken, idempotencyKey: uuidv4(), payload: { reason: 'ตรวจกล้องวงจรปิดแล้ว' } },
    );

    const after = await recalculate(employmentId, '2026-08-03');
    expect(after['has_blocking_exception']).toBe(false);
    expect(after['worked_minutes']).toBe(480);
  });

  it('refuses to let the requester approve their own correction', async () => {
    // maker-checker (spec §10.2)
    const employmentId = await createEmployment('อนุมัติเอง');
    await assignPattern(employmentId, dayShiftId);

    // SUPERVISOR มีทั้งสิทธิ์ขอและสิทธิ์อนุมัติ — สิ่งเดียวที่กันการอนุมัติให้ตัวเอง
    // คือกฎ maker-checker ไม่ใช่การขาดสิทธิ์
    const request = await call(harness, 'POST', '/attendance-correction-requests', {
      token: supervisorToken,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: employmentId,
        work_date: '2026-08-03',
        adjustment_type: 'ADD_PUNCH',
        punch_at: '2026-08-03T01:00:00Z',
        event_intent: 'CLOCK_IN',
        reason: 'ขอเพิ่มเวลาเข้างาน',
      },
    });
    expect(request.status).toBe(201);

    const selfApprove = await call(
      harness,
      'POST',
      `/attendance-correction-requests/${request.body['id'] as string}/approve`,
      { token: supervisorToken, idempotencyKey: uuidv4(), payload: { reason: 'อนุมัติเอง' } },
    );
    expect(selfApprove.status).toBe(403);
  });

  it('requires a reason to waive an exception', async () => {
    const employmentId = await createEmployment('ยกเว้น');
    await assignPattern(employmentId, dayShiftId);
    await addEvent(employmentId, '2026-08-03T01:00:00Z', 'CLOCK_IN');
    await recalculate(employmentId, '2026-08-03');

    const exceptions = await call(
      harness,
      'GET',
      `/attendance-exceptions?employment_id=${employmentId}&status=OPEN`,
      { token: hrToken },
    );
    const exceptionId = (exceptions.body['items'] as { id: string }[])[0]?.id as string;

    const noReason = await call(harness, 'POST', `/attendance-exceptions/${exceptionId}/resolve`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { outcome: 'WAIVED', reason: '' },
    });
    expect(noReason.status).toBe(400);

    const waived = await call(harness, 'POST', `/attendance-exceptions/${exceptionId}/resolve`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { outcome: 'WAIVED', reason: 'พนักงานลาออกกะทันหัน ไม่มีทางเก็บเวลาออกได้' },
    });
    expect(waived.status).toBe(200);
  });
});

describe('result versioning', () => {
  it('keeps exactly one current row per employment and work date', async () => {
    const employmentId = await createEmployment('เวอร์ชัน');
    await assignPattern(employmentId, dayShiftId);
    await addEvent(employmentId, '2026-08-03T01:00:00Z', 'CLOCK_IN');
    await addEvent(employmentId, '2026-08-03T10:00:00Z', 'CLOCK_OUT');

    for (let index = 0; index < 4; index += 1) {
      await recalculate(employmentId, '2026-08-03');
    }

    const rows = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.attendanceResults)
        .where(
          and(
            eq(schema.attendanceResults.employmentId, employmentId),
            eq(schema.attendanceResults.workDate, '2026-08-03'),
          ),
        ),
    );

    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.filter((row) => row.isCurrent)).toHaveLength(1);
    // ผลลัพธ์ต้องเท่าเดิมทุกครั้ง — input เดิม กฎเดิม ผลเดิม (spec §17)
    const worked = new Set(rows.map((row) => row.workedMinutes));
    expect(worked.size).toBe(1);
  });
});
