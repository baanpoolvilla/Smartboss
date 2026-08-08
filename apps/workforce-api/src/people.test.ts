import { schema, withTenant } from '@workforce/db';
import { uuidv4 } from '@workforce/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createTestHarness, type TestHarness, type TestTenant } from './testing/test-app';

let harness: TestHarness;
let tenant: TestTenant;
let hrToken: string;
let preparerToken: string;
let auditorToken: string;

async function createPerson(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await call(harness, 'POST', '/people', {
    token: hrToken,
    idempotencyKey: uuidv4(),
    payload: {
      first_name: 'สมชาย',
      last_name: 'ใจดี',
      preferred_name: 'ชาย',
      ...overrides,
    },
  });
  expect(response.status).toBe(201);
  return response.body['id'] as string;
}

async function createEmployment(personId: string, hiredOn = '2026-01-05'): Promise<string> {
  const response = await call(harness, 'POST', '/employments', {
    token: hrToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      person_id: personId,
      employee_code: `EMP-${uuidv4().slice(0, 8)}`,
      employment_type: 'MONTHLY',
      hired_on: hiredOn,
    },
  });
  expect(response.status).toBe(201);
  return response.body['id'] as string;
}

beforeAll(async () => {
  harness = await createTestHarness();
  tenant = await harness.createTenant('people');

  await harness.createPrincipal(tenant, { subject: 'p|hr', roles: ['HR_OFFICER'] });
  await harness.createPrincipal(tenant, { subject: 'p|preparer', roles: ['PAYROLL_PREPARER'] });
  await harness.createPrincipal(tenant, { subject: 'p|auditor', roles: ['AUDITOR'] });

  hrToken = await harness.token('p|hr', tenant.tenantId);
  preparerToken = await harness.token('p|preparer', tenant.tenantId);
  auditorToken = await harness.token('p|auditor', tenant.tenantId);
}, 120_000);

afterAll(async () => {
  await harness.close();
});

describe('people', () => {
  it('creates a person and never returns the national ID', async () => {
    const response = await call(harness, 'POST', '/people', {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: {
        first_name: 'อารีย์',
        last_name: 'บุคคลดี',
        preferred_name: 'อา',
        national_id: '1234567890123',
      },
    });

    expect(response.status).toBe(201);
    expect(response.body['has_national_id']).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('1234567890123');
    // ชื่อเล่นแยกจากชื่อจริง (คงคุณสมบัติจากระบบเดิม)
    expect(response.body['display_name']).toBe('อา');
  });

  it('stores the national ID encrypted, not in clear text', async () => {
    const personId = await createPerson({ national_id: '9876543210987', first_name: 'ปรีชา' });

    const stored = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx.select().from(schema.people).where(eq(schema.people.id, personId)),
    );

    const row = stored[0];
    expect(row).toBeDefined();
    // bytea กลับมาเป็น Buffer (node-postgres) หรือ Uint8Array (PGlite) แล้วแต่ driver
    const ciphertext = row?.nationalIdEncrypted as Uint8Array | null;
    expect(ciphertext).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(ciphertext as Uint8Array).toString('utf8')).not.toContain('9876543210987');
    expect(Buffer.from(ciphertext as Uint8Array).toString('hex')).not.toContain(
      Buffer.from('9876543210987').toString('hex'),
    );
    expect(row?.nationalIdHash).toBeInstanceOf(Uint8Array);
  });

  it('rejects a duplicate national ID without revealing whose it is', async () => {
    await createPerson({ national_id: '1111111111111', first_name: 'ก' });
    const response = await call(harness, 'POST', '/people', {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { first_name: 'ข', last_name: 'ค', national_id: '1111111111111' },
    });

    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).not.toContain('1111111111111');
  });

  it('rejects invalid input with field-level detail', async () => {
    const response = await call(harness, 'POST', '/people', {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { first_name: '', last_name: 'ใจดี', email: 'not-an-email' },
    });

    expect(response.status).toBe(400);
    expect(response.body['code']).toBe('VALIDATION_FAILED');
    const errors = response.body['errors'] as { path: string }[];
    expect(errors.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['first_name', 'email']),
    );
  });
});

describe('idempotency', () => {
  it('replays the original response for a repeated key', async () => {
    const key = uuidv4();
    const payload = { first_name: 'ซ้ำ', last_name: 'ได้', preferred_name: '' };

    const first = await call(harness, 'POST', '/people', {
      token: hrToken,
      idempotencyKey: key,
      payload,
    });
    const second = await call(harness, 'POST', '/people', {
      token: hrToken,
      idempotencyKey: key,
      payload,
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // สร้าง resource เดียว ไม่ใช่สองอัน — spec §17 duplicate from retry = 0
    expect(second.body['id']).toBe(first.body['id']);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(first.headers['idempotency-replayed']).toBeUndefined();
  });

  it('rejects the same key with a different payload', async () => {
    const key = uuidv4();
    await call(harness, 'POST', '/people', {
      token: hrToken,
      idempotencyKey: key,
      payload: { first_name: 'หนึ่ง', last_name: 'สอง' },
    });

    const conflicting = await call(harness, 'POST', '/people', {
      token: hrToken,
      idempotencyKey: key,
      payload: { first_name: 'สาม', last_name: 'สี่' },
    });

    expect(conflicting.status).toBe(422);
    expect(conflicting.body['code']).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('requires the header on routes that declare it', async () => {
    const response = await call(harness, 'POST', '/people', {
      token: hrToken,
      payload: { first_name: 'ไม่มี', last_name: 'คีย์' },
    });
    expect(response.status).toBe(400);
  });

  it('releases the key when the request fails so the client can retry', async () => {
    const key = uuidv4();
    const failing = await call(harness, 'POST', '/people', {
      token: hrToken,
      idempotencyKey: key,
      payload: { first_name: '', last_name: '' },
    });
    expect(failing.status).toBe(400);

    // คีย์เดิมต้องใช้ได้อีกครั้ง — ไม่ค้างเป็น 409 ทั้งที่ยังไม่มีอะไรถูกบันทึก
    const retry = await call(harness, 'POST', '/people', {
      token: hrToken,
      idempotencyKey: key,
      payload: { first_name: 'ลอง', last_name: 'ใหม่' },
    });
    expect(retry.status).toBe(201);
  });
});

describe('employment and effective-dated assignments', () => {
  it('creates an employment and emits a domain event through the outbox', async () => {
    const personId = await createPerson({ first_name: 'พนักงาน' });
    const employmentId = await createEmployment(personId);

    const messages = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.outboxMessages)
        .where(eq(schema.outboxMessages.aggregateId, employmentId)),
    );

    // side effect ออกผ่าน outbox ใน transaction เดียวกับข้อมูล ไม่ใช่ยิง HTTP กลางคัน (ADR-0008)
    expect(messages.map((message) => message.eventType)).toContain('people.employment.created');
    expect(messages[0]?.status).toBe('PENDING');
  });

  it('rejects overlapping assignment periods with a clear conflict, not a 500', async () => {
    const personId = await createPerson({ first_name: 'ทับซ้อน' });
    const employmentId = await createEmployment(personId, '2026-01-01');

    const first = await call(harness, 'POST', `/employments/${employmentId}/assignments`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { effective_from: '2026-01-01' },
    });
    expect(first.status).toBe(201);

    const overlapping = await call(harness, 'POST', `/employments/${employmentId}/assignments`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { effective_from: '2026-06-01' },
    });

    expect(overlapping.status).toBe(409);
    expect(overlapping.body['code']).toBe('EFFECTIVE_PERIOD_OVERLAP');
  });

  it('supersedes the open assignment when asked, keeping the old row intact', async () => {
    const personId = await createPerson({ first_name: 'ย้ายแผนก' });
    const employmentId = await createEmployment(personId, '2026-01-01');

    await call(harness, 'POST', `/employments/${employmentId}/assignments`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { effective_from: '2026-01-01' },
    });

    const superseding = await call(harness, 'POST', `/employments/${employmentId}/assignments`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { effective_from: '2026-06-01', supersede_current: true },
    });
    expect(superseding.status).toBe(201);

    const history = await call(harness, 'GET', `/employments/${employmentId}/assignments`, {
      token: hrToken,
    });
    const items = history.body['items'] as { effective_from: string; effective_to: string | null }[];

    // ประวัติเดิมยังอยู่ ปิดท้ายที่วันก่อนช่วงใหม่จะเริ่ม — ไม่ถูกลบทิ้ง (ADR-0012)
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ effective_from: '2026-06-01', effective_to: null });
    expect(items[1]).toMatchObject({ effective_from: '2026-01-01', effective_to: '2026-05-31' });
  });

  it('refuses an assignment that starts before the hire date', async () => {
    const personId = await createPerson({ first_name: 'ก่อนเข้างาน' });
    const employmentId = await createEmployment(personId, '2026-03-01');

    const response = await call(harness, 'POST', `/employments/${employmentId}/assignments`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { effective_from: '2026-01-01' },
    });
    expect(response.status).toBe(400);
  });

  it('terminates an employment and records the reason', async () => {
    const personId = await createPerson({ first_name: 'ลาออก' });
    const employmentId = await createEmployment(personId, '2026-01-01');

    const response = await call(harness, 'POST', `/employments/${employmentId}/terminate`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { terminated_on: '2026-08-31', reason: 'ลาออกตามความสมัครใจ' },
    });

    expect(response.status).toBe(200);
    expect(response.body['status']).toBe('TERMINATED');
    expect(response.body['terminated_on']).toBe('2026-08-31');

    const repeat = await call(harness, 'POST', `/employments/${employmentId}/terminate`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { terminated_on: '2026-09-30', reason: 'ซ้ำ' },
    });
    expect(repeat.status).toBe(409);
  });
});

describe('effective-dated compensation', () => {
  it('keeps salary history instead of overwriting it', async () => {
    const personId = await createPerson({ first_name: 'ขึ้นเงินเดือน' });
    const employmentId = await createEmployment(personId, '2026-01-01');

    const initial = await call(harness, 'POST', '/compensation-rates', {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: employmentId,
        pay_basis: 'MONTHLY',
        amount: '30000.00',
        effective_from: '2026-01-01',
      },
    });
    expect(initial.status).toBe(201);
    // เงินเดินทางเป็น string ที่ scale 4 (spec §13, ADR-0007)
    expect(initial.body['amount']).toBe('30000.0000');

    const raise = await call(harness, 'POST', '/compensation-rates', {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: employmentId,
        pay_basis: 'MONTHLY',
        amount: '33000.00',
        effective_from: '2026-08-01',
        supersede_current: true,
        approval_reference: 'HR-2026-0812',
      },
    });
    expect(raise.status).toBe(201);

    // จุดที่ระบบเดิมพัง: คำนวณงวดเดือนมิถุนายนใหม่ต้องยังได้ 30,000 (spec §3.3 P9)
    const asJune = await call(
      harness,
      'GET',
      `/compensation-rates?employment_id=${employmentId}&as_of=2026-06-15`,
      { token: preparerToken },
    );
    const juneItems = asJune.body['items'] as { amount: string }[];
    expect(juneItems).toHaveLength(1);
    expect(juneItems[0]?.amount).toBe('30000.0000');

    const asAugust = await call(
      harness,
      'GET',
      `/compensation-rates?employment_id=${employmentId}&as_of=2026-08-15`,
      { token: preparerToken },
    );
    const augustItems = asAugust.body['items'] as { amount: string }[];
    expect(augustItems[0]?.amount).toBe('33000.0000');

    const all = await call(harness, 'GET', `/compensation-rates?employment_id=${employmentId}`, {
      token: preparerToken,
    });
    expect((all.body['items'] as unknown[]).length).toBe(2);
  });

  it('rejects an amount with more precision than the schema can hold', async () => {
    const personId = await createPerson({ first_name: 'เศษสตางค์' });
    const employmentId = await createEmployment(personId, '2026-01-01');

    const response = await call(harness, 'POST', '/compensation-rates', {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: employmentId,
        pay_basis: 'MONTHLY',
        amount: '30000.123456',
        effective_from: '2026-01-01',
      },
    });
    expect(response.status).toBe(400);
  });

  it('rejects a numeric amount — money travels as a string', async () => {
    const personId = await createPerson({ first_name: 'ตัวเลข' });
    const employmentId = await createEmployment(personId, '2026-01-01');

    const response = await call(harness, 'POST', '/compensation-rates', {
      token: preparerToken,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: employmentId,
        pay_basis: 'MONTHLY',
        amount: 30000.5,
        effective_from: '2026-01-01',
      },
    });
    expect(response.status).toBe(400);
  });
});

describe('audit trail', () => {
  it('records who changed what, with sensitive values redacted', async () => {
    const personId = await createPerson({
      first_name: 'ตรวจสอบ',
      national_id: '5555555555555',
    });

    const response = await call(
      harness,
      'GET',
      `/audit-events?resource_type=person&resource_id=${personId}`,
      { token: auditorToken },
    );

    expect(response.status).toBe(200);
    const events = response.body['items'] as Record<string, unknown>[];
    expect(events).toHaveLength(1);

    const event = events[0] as Record<string, unknown>;
    expect(event['action']).toBe('people.person.create');
    expect(event['outcome']).toBe('SUCCESS');
    expect(event['actor_type']).toBe('PRINCIPAL');
    expect(event['request_id']).toBeTruthy();

    // audit ไม่ใช่ที่เก็บ PII — ค่าอ่อนไหวต้องถูกปิดก่อนเขียน (ADR-0009 ข้อ 3)
    expect(JSON.stringify(event)).not.toContain('5555555555555');
  });

  it('is written in the same transaction as the change it describes', async () => {
    const before = await call(harness, 'GET', '/audit-events?action=people.employment.create', {
      token: auditorToken,
    });
    const beforeCount = (before.body['items'] as unknown[]).length;

    const personId = await createPerson({ first_name: 'ทรานแซกชัน' });
    await createEmployment(personId);

    const after = await call(harness, 'GET', '/audit-events?action=people.employment.create', {
      token: auditorToken,
    });
    expect((after.body['items'] as unknown[]).length).toBe(beforeCount + 1);
  });

  it('is not readable without the audit permission', async () => {
    const response = await call(harness, 'GET', '/audit-events', { token: preparerToken });
    expect(response.status).toBe(403);
  });
});
