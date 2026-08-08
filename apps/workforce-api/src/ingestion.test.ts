import { schema, withTenant } from '@workforce/db';
import { uuidv4, uuidv7 } from '@workforce/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeDevice } from './testing/device-client';
import { call, createTestHarness, type TestHarness, type TestTenant } from './testing/test-app';

let harness: TestHarness;
let tenant: TestTenant;
let technicianToken: string;
let hrToken: string;
let auditorToken: string;

/** สร้างเครื่อง + activate ให้พร้อมส่งข้อมูล */
async function provisionDevice(code: string): Promise<FakeDevice> {
  const created = await call(harness, 'POST', '/devices', {
    token: technicianToken,
    idempotencyKey: uuidv4(),
    payload: { company_id: tenant.companyId, device_code: code, name: `Terminal ${code}` },
  });
  expect(created.status).toBe(201);

  const tokenResponse = await call(
    harness,
    'POST',
    `/devices/${created.body['id'] as string}/activation-tokens`,
    { token: technicianToken, idempotencyKey: uuidv4(), payload: { ttl_seconds: 3600 } },
  );
  expect(tokenResponse.status).toBe(201);

  const activated = await FakeDevice.activate(
    harness,
    tokenResponse.body['activation_token'] as string,
  );
  expect(activated.status).toBe(200);
  return activated.device;
}

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
      employee_code: `E-${uuidv4().slice(0, 8)}`,
      employment_type: 'MONTHLY',
      hired_on: '2026-01-01',
    },
  });
  return employment.body['id'] as string;
}

/** ผูกนิ้วกับ slot: สั่ง enroll แล้วให้เครื่อง ACK กลับ */
async function enroll(device: FakeDevice, employmentId: string, slot: number): Promise<void> {
  const requested = await call(harness, 'POST', '/biometric-enrollments', {
    token: technicianToken,
    idempotencyKey: uuidv4(),
    payload: {
      employment_id: employmentId,
      device_id: device.deviceId,
      template_slot: slot,
      ttl_seconds: 600,
    },
  });
  expect(requested.status).toBe(202);

  const commands = await device.get('/device-ingestion/commands');
  const items = commands.body['items'] as { nonce: string; command_type: string }[];
  const command = items.find((entry) => entry.command_type === 'ENROLL_BIOMETRIC');
  expect(command).toBeDefined();

  const acked = await device.post('/device-ingestion/commands:ack', {
    nonce: command?.nonce,
    outcome: 'SUCCESS',
    result: {},
    quality: 88,
  });
  expect(acked.status).toBe(201);
}

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: uuidv7(),
    sequence: 1,
    captured_at: '2026-08-01T01:05:00.000Z',
    timezone: 'Asia/Bangkok',
    event_intent: 'AUTO',
    template_slot: 1,
    evidence: { match_score: 92, sensor_quality: 90 },
    ...overrides,
  };
}

beforeAll(async () => {
  harness = await createTestHarness();
  tenant = await harness.createTenant('ingest');

  await harness.createPrincipal(tenant, { subject: 'i|tech', roles: ['DEVICE_TECHNICIAN'] });
  await harness.createPrincipal(tenant, { subject: 'i|hr', roles: ['HR_OFFICER'] });
  await harness.createPrincipal(tenant, { subject: 'i|auditor', roles: ['AUDITOR'] });

  technicianToken = await harness.token('i|tech', tenant.tenantId);
  hrToken = await harness.token('i|hr', tenant.tenantId);
  auditorToken = await harness.token('i|auditor', tenant.tenantId);
}, 180_000);

afterAll(async () => {
  await harness.close();
});

describe('device provisioning and activation', () => {
  it('activates a device with a one-time token and stores only the public key', async () => {
    const device = await provisionDevice('ACT-01');

    const stored = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.deviceCredentials)
        .where(eq(schema.deviceCredentials.deviceId, device.deviceId)),
    );

    expect(stored).toHaveLength(1);
    expect(stored[0]?.status).toBe('ACTIVE');
    expect(stored[0]?.algorithm).toBe('ed25519');
    // เก็บเฉพาะ public key — private key ไม่เคยออกจากเครื่อง
    expect(Buffer.from(stored[0]?.publicKey as Uint8Array)).toHaveLength(32);
  });

  it('rejects an activation token that was already used', async () => {
    const created = await call(harness, 'POST', '/devices', {
      token: technicianToken,
      idempotencyKey: uuidv4(),
      payload: { company_id: tenant.companyId, device_code: 'ACT-02' },
    });
    const tokenResponse = await call(
      harness,
      'POST',
      `/devices/${created.body['id'] as string}/activation-tokens`,
      { token: technicianToken, idempotencyKey: uuidv4(), payload: { ttl_seconds: 3600 } },
    );
    const activationToken = tokenResponse.body['activation_token'] as string;

    expect((await FakeDevice.activate(harness, activationToken)).status).toBe(200);
    // token ใช้ได้ครั้งเดียว — ครั้งที่สองต้องไม่ผ่าน
    expect((await FakeDevice.activate(harness, activationToken)).status).toBe(401);
  });

  it('rejects an expired activation token', async () => {
    const created = await call(harness, 'POST', '/devices', {
      token: technicianToken,
      idempotencyKey: uuidv4(),
      payload: { company_id: tenant.companyId, device_code: 'ACT-03' },
    });
    const tokenResponse = await call(
      harness,
      'POST',
      `/devices/${created.body['id'] as string}/activation-tokens`,
      { token: technicianToken, idempotencyKey: uuidv4(), payload: { ttl_seconds: 60 } },
    );

    harness.clock.advanceBy(120_000);
    const result = await FakeDevice.activate(
      harness,
      tokenResponse.body['activation_token'] as string,
    );
    harness.clock.advanceBy(-120_000);

    expect(result.status).toBe(401);
  });

  it('rejects a garbage activation token', async () => {
    expect((await FakeDevice.activate(harness, 'wfd_not-a-real-token-value-12345')).status).toBe(401);
  });
});

describe('device authentication', () => {
  it('rejects a batch with no signature headers', async () => {
    const response = await call(harness, 'POST', '/device-ingestion/time-events:batch', {
      payload: { batch_id: uuidv4(), device_time: '2026-08-01T02:00:00.000Z', events: [event()] },
    });
    expect(response.status).toBe(401);
  });

  it('rejects a tampered signature', async () => {
    const device = await provisionDevice('AUTH-01');
    const response = await device.post(
      '/device-ingestion/time-events:batch',
      { batch_id: uuidv4(), device_time: '2026-08-01T02:00:00.000Z', events: [event()] },
      { corruptSignature: true },
    );
    expect(response.status).toBe(401);
  });

  it('rejects a replayed request signed long ago', async () => {
    const device = await provisionDevice('AUTH-02');
    const response = await device.post(
      '/device-ingestion/time-events:batch',
      { batch_id: uuidv4(), device_time: '2026-08-01T02:00:00.000Z', events: [event()] },
      { timestamp: '2026-07-01T00:00:00.000Z' },
    );
    expect(response.status).toBe(401);
  });

  it('stops accepting events once the device is revoked', async () => {
    const device = await provisionDevice('AUTH-03');
    const before = await device.post('/device-ingestion/heartbeats', {
      device_time: '2026-08-01T02:00:00.000Z',
      queue_depth: 0,
      template_count: 0,
    });
    expect(before.status).toBe(201);

    const revoked = await call(harness, 'POST', `/devices/${device.deviceId}/revoke`, {
      token: technicianToken,
      idempotencyKey: uuidv4(),
      payload: { reason: 'เครื่องสูญหาย' },
    });
    expect(revoked.status).toBe(200);

    const after = await device.post('/device-ingestion/heartbeats', {
      device_time: '2026-08-01T02:00:00.000Z',
      queue_depth: 0,
      template_count: 0,
    });
    expect(after.status).toBe(401);
  });
});

describe('raw time event ingestion', () => {
  it('accepts a batch and resolves the slot to an employment', async () => {
    const device = await provisionDevice('ING-01');
    const employmentId = await createEmployment('สมชาย');
    await enroll(device, employmentId, 1);

    const response = await device.post('/device-ingestion/time-events:batch', {
      batch_id: uuidv4(),
      device_time: '2026-08-01T02:00:00.000Z',
      events: [event({ sequence: 10 })],
    });

    expect(response.status).toBe(201);
    expect(response.body['accepted']).toBe(1);
    expect(response.body['acked_sequence']).toBe(10);

    const stored = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.rawTimeEvents)
        .where(eq(schema.rawTimeEvents.sourceId, device.deviceId)),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.employmentId).toBe(employmentId);
    // เวลาที่เครื่องบันทึกต้องถูกเก็บไว้ ไม่ถูกแทนด้วยเวลาที่ server ได้รับ (spec §6.2)
    expect(stored[0]?.capturedAt.toISOString()).toBe('2026-08-01T01:05:00.000Z');
  });

  it('makes a retried batch produce exactly one record', async () => {
    // spec §17: duplicate from retry = 0
    const device = await provisionDevice('ING-02');
    const employmentId = await createEmployment('อารีย์');
    await enroll(device, employmentId, 1);

    const batch = {
      batch_id: uuidv4(),
      device_time: '2026-08-01T02:00:00.000Z',
      events: [event({ sequence: 5 }), event({ sequence: 6 })],
    };

    const first = await device.post('/device-ingestion/time-events:batch', batch);
    const second = await device.post('/device-ingestion/time-events:batch', batch);
    const third = await device.post('/device-ingestion/time-events:batch', batch);

    expect(first.body['accepted']).toBe(2);
    expect(second.body['duplicates']).toBe(2);
    expect(second.body['accepted']).toBe(0);
    expect(third.body['duplicates']).toBe(2);

    const stored = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.rawTimeEvents)
        .where(eq(schema.rawTimeEvents.sourceId, device.deviceId)),
    );
    expect(stored).toHaveLength(2);
  });

  it('quarantines a sequence reused with a different payload', async () => {
    // spec §6.1: payload hash ต่างแต่ sequence เดิม → quarantine ไม่ทับของเดิม
    const device = await provisionDevice('ING-03');
    const employmentId = await createEmployment('ปรีชา');
    await enroll(device, employmentId, 1);

    await device.post('/device-ingestion/time-events:batch', {
      batch_id: uuidv4(),
      device_time: '2026-08-01T02:00:00.000Z',
      events: [event({ sequence: 20, captured_at: '2026-08-01T01:00:00.000Z' })],
    });

    const conflicting = await device.post('/device-ingestion/time-events:batch', {
      batch_id: uuidv4(),
      device_time: '2026-08-01T02:00:00.000Z',
      events: [event({ sequence: 20, captured_at: '2026-08-01T09:00:00.000Z' })],
    });

    expect(conflicting.body['quarantined']).toBe(1);
    expect(conflicting.body['accepted']).toBe(0);

    const [events, quarantined] = await withTenant(
      harness.database.db,
      tenant.tenantId,
      async (tx) => [
        await tx
          .select()
          .from(schema.rawTimeEvents)
          .where(eq(schema.rawTimeEvents.sourceId, device.deviceId)),
        await tx
          .select()
          .from(schema.rawTimeEventQuarantine)
          .where(eq(schema.rawTimeEventQuarantine.sourceId, device.deviceId)),
      ],
    );

    // ของเดิมยังอยู่และไม่ถูกแก้
    expect(events).toHaveLength(1);
    expect(events[0]?.capturedAt.toISOString()).toBe('2026-08-01T01:00:00.000Z');
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]?.reason).toBe('SEQUENCE_REUSED_WITH_DIFFERENT_PAYLOAD');
  });

  it('keeps events from an unknown finger without turning them into work time', async () => {
    // ระบบเดิมสร้าง attendance log ให้ 'Unknown' (spec §3.3 C9)
    const device = await provisionDevice('ING-04');

    const response = await device.post('/device-ingestion/time-events:batch', {
      batch_id: uuidv4(),
      device_time: '2026-08-01T02:00:00.000Z',
      events: [event({ sequence: 1, template_slot: 999 })],
    });
    expect(response.body['accepted']).toBe(1);

    const stored = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.rawTimeEvents)
        .where(eq(schema.rawTimeEvents.sourceId, device.deviceId)),
    );
    expect(stored[0]?.employmentId).toBeNull();
    expect((stored[0]?.evidence as Record<string, unknown>)['slot_resolved']).toBe(false);
  });

  it('survives a 30-day offline period and flags the age', async () => {
    // spec §19.1: offline 30 วันแล้วยังเก็บ event ครบ
    const device = await provisionDevice('ING-05');
    const employmentId = await createEmployment('ออฟไลน์');
    await enroll(device, employmentId, 1);

    const events = Array.from({ length: 30 }, (_, day) =>
      event({
        sequence: 100 + day,
        captured_at: new Date(Date.UTC(2026, 6, 1 + day, 1, 5)).toISOString(),
      }),
    );

    const response = await device.post('/device-ingestion/time-events:batch', {
      batch_id: uuidv4(),
      device_time: '2026-08-01T02:00:00.000Z',
      queue_depth: 30,
      events,
    });

    expect(response.status).toBe(201);
    expect(response.body['accepted']).toBe(30);
    expect(response.body['acked_sequence']).toBe(129);

    const stored = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.rawTimeEvents)
        .where(eq(schema.rawTimeEvents.sourceId, device.deviceId)),
    );
    expect(stored).toHaveLength(30);
    // เวลาจริงของแต่ละวันต้องถูกเก็บไว้ ไม่ยุบเป็นเวลาที่ sync
    const capturedDays = new Set(stored.map((row) => row.capturedAt.toISOString().slice(0, 10)));
    expect(capturedDays.size).toBe(30);
  });

  it('records clock drift without rewriting the captured time', async () => {
    const device = await provisionDevice('ING-06');
    const employmentId = await createEmployment('นาฬิกาเพี้ยน');
    await enroll(device, employmentId, 1);

    const response = await device.post('/device-ingestion/time-events:batch', {
      batch_id: uuidv4(),
      // เครื่องคิดว่าตอนนี้คือ 3 ชั่วโมงข้างหน้า
      device_time: '2026-08-01T05:00:00.000Z',
      events: [event({ sequence: 50 })],
    });

    expect(response.body['clock_drift_ms']).toBe(3 * 3600 * 1000);

    const anomalies = await call(harness, 'GET', '/audit-events?action=device.clock.anomaly', {
      token: auditorToken,
    });
    expect((anomalies.body['items'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('refuses to mutate a stored raw event', async () => {
    const device = await provisionDevice('ING-07');
    const employmentId = await createEmployment('ห้ามแก้');
    await enroll(device, employmentId, 1);
    await device.post('/device-ingestion/time-events:batch', {
      batch_id: uuidv4(),
      device_time: '2026-08-01T02:00:00.000Z',
      events: [event({ sequence: 77 })],
    });

    await expect(
      withTenant(harness.database.db, tenant.tenantId, async (tx) => {
        await tx
          .update(schema.rawTimeEvents)
          .set({ eventIntent: 'CLOCK_OUT' })
          .where(eq(schema.rawTimeEvents.sourceId, device.deviceId));
      }),
    ).rejects.toThrow();
  });
});

describe('device commands and biometric lifecycle', () => {
  it('rejects an acknowledgement replayed with the same nonce', async () => {
    const device = await provisionDevice('CMD-01');
    const employmentId = await createEmployment('นอนซ์');

    await call(harness, 'POST', '/biometric-enrollments', {
      token: technicianToken,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: employmentId,
        device_id: device.deviceId,
        template_slot: 3,
        ttl_seconds: 600,
      },
    });

    const commands = await device.get('/device-ingestion/commands');
    const nonce = (commands.body['items'] as { nonce: string }[])[0]?.nonce;

    const first = await device.post('/device-ingestion/commands:ack', {
      nonce,
      outcome: 'SUCCESS',
      result: {},
    });
    expect(first.status).toBe(201);

    const replay = await device.post('/device-ingestion/commands:ack', {
      nonce,
      outcome: 'SUCCESS',
      result: {},
    });
    expect(replay.status).toBe(409);
  });

  it('rejects an expired enrolment command', async () => {
    const device = await provisionDevice('CMD-02');
    const employmentId = await createEmployment('หมดอายุ');

    await call(harness, 'POST', '/biometric-enrollments', {
      token: technicianToken,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: employmentId,
        device_id: device.deviceId,
        template_slot: 4,
        ttl_seconds: 60,
      },
    });

    const commands = await device.get('/device-ingestion/commands');
    const nonce = (commands.body['items'] as { nonce: string }[])[0]?.nonce;

    harness.clock.advanceBy(120_000);
    const expired = await device.post('/device-ingestion/commands:ack', {
      nonce,
      outcome: 'SUCCESS',
      result: {},
    });
    harness.clock.advanceBy(-120_000);

    expect(expired.status).toBe(409);
  });

  it('refuses to reuse an occupied template slot', async () => {
    const device = await provisionDevice('CMD-03');
    const first = await createEmployment('เจ้าของสล็อต');
    const second = await createEmployment('คนใหม่');

    await enroll(device, first, 7);

    const conflict = await call(harness, 'POST', '/biometric-enrollments', {
      token: technicianToken,
      idempotencyKey: uuidv4(),
      payload: {
        employment_id: second,
        device_id: device.deviceId,
        template_slot: 7,
        ttl_seconds: 600,
      },
    });
    // slot ค้างของคนเก่าคือสาเหตุที่ทำให้เครื่อง match ผิดคน
    expect(conflict.status).toBe(409);
  });

  it('creates a deletion job per device on offboarding and clears it on ACK', async () => {
    // spec §6.2: offboarding ต้องสร้าง deletion job ทุกเครื่องและรอ ACK
    const deviceA = await provisionDevice('DEL-01');
    const deviceB = await provisionDevice('DEL-02');
    const employmentId = await createEmployment('ลาออก');

    await enroll(deviceA, employmentId, 11);
    await enroll(deviceB, employmentId, 11);

    const deleted = await call(
      harness,
      'POST',
      `/employments/${employmentId}/biometric-enrollments:delete`,
      {
        token: technicianToken,
        idempotencyKey: uuidv4(),
        payload: { reason: 'พ้นสภาพพนักงาน' },
      },
    );
    expect(deleted.status).toBe(202);
    expect(deleted.body['jobs']).toBe(2);

    for (const device of [deviceA, deviceB]) {
      const commands = await device.get('/device-ingestion/commands');
      const command = (commands.body['items'] as { nonce: string; command_type: string }[]).find(
        (entry) => entry.command_type === 'DELETE_BIOMETRIC',
      );
      const ack = await device.post('/device-ingestion/commands:ack', {
        nonce: command?.nonce,
        outcome: 'SUCCESS',
        result: {},
      });
      expect(ack.status).toBe(201);
    }

    const [jobs, enrollments] = await withTenant(
      harness.database.db,
      tenant.tenantId,
      async (tx) => [
        await tx
          .select()
          .from(schema.biometricDeletionJobs)
          .where(eq(schema.biometricDeletionJobs.employmentId, employmentId)),
        await tx
          .select()
          .from(schema.biometricEnrollments)
          .where(eq(schema.biometricEnrollments.employmentId, employmentId)),
      ],
    );

    expect(jobs.every((job) => job.status === 'ACKED')).toBe(true);
    expect(enrollments.every((row) => row.status === 'DELETED')).toBe(true);
    // hash ของ template ที่ลบแล้วต้องไม่ค้างอยู่
    expect(enrollments.every((row) => row.templateHash === null)).toBe(true);
  });

  it('never exposes template material through the API', async () => {
    const device = await provisionDevice('PRIV-01');
    const employmentId = await createEmployment('ความเป็นส่วนตัว');
    await enroll(device, employmentId, 21);

    const response = await call(
      harness,
      'GET',
      `/biometric-enrollments?employment_id=${employmentId}`,
      { token: technicianToken },
    );

    expect(response.status).toBe(200);
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain('template_hash');
    expect(serialised).not.toContain('templateHash');
    expect(serialised).toContain('template_slot');
  });
});

describe('legacy adapter', () => {
  it('is disabled when no legacy key is configured', async () => {
    // harness ไม่ได้ตั้ง LEGACY_INGEST_KEY — adapter ต้องมองไม่เห็นเลย
    const response = await call(harness, 'POST', '/legacy/attendance', {
      payload: { device_id: 'OFFICE', finger_id: 1 },
    });
    expect(response.status).toBe(404);
  });
});
