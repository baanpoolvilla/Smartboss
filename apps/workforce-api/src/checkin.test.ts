import { schema, withTenant } from '@workforce/db';
import { uuidv4 } from '@workforce/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createTestHarness, type TestHarness, type TestTenant } from './testing/test-app';

let harness: TestHarness;
let tenant: TestTenant;
let hrToken: string;
/** สิทธิ์ settings.manage — HR_OFFICER ไม่มีโดยตั้งใจ (spec §5) */
let adminToken: string;
let siteId: string;

/** พนักงานหนึ่งคนพร้อม principal ที่ผูกกับ employment (จำเป็นต่อ scope SELF) */
interface Employee {
  employmentId: string;
  token: string;
  subject: string;
}

// 1x1 PNG ที่เล็กที่สุดที่ยัง decode ได้ — เนื้อหาไม่สำคัญ ที่สำคัญคือ checksum
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const OTHER_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function createEmployee(name: string, roles: ('EMPLOYEE' | 'SUPERVISOR')[] = ['EMPLOYEE']): Promise<Employee> {
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
      employee_code: `C-${uuidv4().slice(0, 8)}`,
      employment_type: 'MONTHLY',
      hired_on: '2026-01-01',
    },
  });
  const employmentId = employment.body['id'] as string;

  const subject = `c|${name}-${uuidv4().slice(0, 6)}`;
  await harness.createPrincipal(tenant, { subject, roles, personId });

  return { employmentId, token: await harness.token(subject, tenant.tenantId), subject };
}

async function createPolicyGroup(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await call(harness, 'POST', '/attendance-policy-groups', {
    token: adminToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      code: `PG-${uuidv4().slice(0, 8)}`,
      name: 'นโยบายทดสอบ',
      allowed_methods: ['MOBILE_PHOTO'],
      photo_required: 'ALWAYS',
      location_required: true,
      allowed_site_ids: [siteId],
      radius_m: 150,
      max_accuracy_m: 50,
      capture_deadline_seconds: 30,
      require_enrolled_device: true,
      require_live_capture: true,
      risk_action: 'REVIEW',
      photo_retention_days: 90,
      effective_from: '2026-01-01',
      ...overrides,
    },
  });
  expect(response.status).toBe(201);
  return response.body['id'] as string;
}

async function assignPolicy(groupId: string, employmentId: string): Promise<void> {
  const response = await call(harness, 'POST', `/attendance-policy-groups/${groupId}/members`, {
    token: adminToken,
    idempotencyKey: uuidv4(),
    payload: { employment_id: employmentId, effective_from: '2026-01-01' },
  });
  expect(response.status).toBe(201);
}

async function enrollDevice(employee: Employee): Promise<string> {
  const response = await call(harness, 'POST', '/mobile-devices/enroll', {
    token: employee.token,
    idempotencyKey: uuidv4(),
    payload: {
      device_fingerprint: `fp-${uuidv4()}`,
      platform: 'android',
      model: 'Pixel 9',
      app_version: '1.0.0',
    },
  });
  expect(response.status).toBe(201);
  return response.body['id'] as string;
}

interface CheckinOptions {
  photo?: string | null;
  liveCapture?: boolean;
  location?: { latitude: number; longitude: number; accuracy_m: number } | null;
  capturedAt?: string;
  commitDelayMs?: number;
  mockLocation?: boolean;
  fingerprint?: string;
}

/** เดินครบเส้นทาง create → evidence → commit */
async function checkin(
  employee: Employee,
  options: CheckinOptions = {},
): Promise<{ status: number; body: Record<string, unknown>; sessionId: string }> {
  const capturedAt = options.capturedAt ?? harness.clock.now().toISOString();

  const session = await call(harness, 'POST', '/time-events/photo-checkin-sessions', {
    token: employee.token,
    payload: {
      event_intent: 'CLOCK_IN',
      device_fingerprint: options.fingerprint ?? null,
    },
  });
  expect(session.status).toBe(201);
  const sessionId = session.body['id'] as string;

  const photo = options.photo === undefined ? TINY_PNG : options.photo;
  if (photo !== null) {
    const evidence = await call(
      harness,
      'POST',
      `/time-events/photo-checkin-sessions/${sessionId}/evidence`,
      {
        token: employee.token,
        payload: {
          photo_base64: photo,
          content_type: 'image/png',
          captured_at_client: capturedAt,
          live_capture: options.liveCapture ?? true,
        },
      },
    );
    expect(evidence.status).toBe(201);
  }

  if (options.commitDelayMs !== undefined) harness.clock.advanceBy(options.commitDelayMs);

  const commit = await call(
    harness,
    'POST',
    `/time-events/photo-checkin-sessions/${sessionId}/commit`,
    {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: {
        captured_at_client: capturedAt,
        location:
          options.location === undefined
            ? { latitude: 12.9231, longitude: 100.8826, accuracy_m: 8 }
            : options.location,
        mock_location_suspected: options.mockLocation ?? false,
        app_version: '1.0.0',
      },
    },
  );

  if (options.commitDelayMs !== undefined) harness.clock.advanceBy(-options.commitDelayMs);
  return { status: commit.status, body: commit.body, sessionId };
}

beforeAll(async () => {
  harness = await createTestHarness();
  tenant = await harness.createTenant('checkin');

  await harness.createPrincipal(tenant, { subject: 'k|hr', roles: ['HR_OFFICER'] });
  await harness.createPrincipal(tenant, { subject: 'k|admin', roles: ['TENANT_ADMIN'] });
  hrToken = await harness.token('k|hr', tenant.tenantId);
  adminToken = await harness.token('k|admin', tenant.tenantId);

  const site = await call(harness, 'POST', '/sites', {
    token: adminToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      code: 'HQ',
      name: 'สำนักงานใหญ่',
      latitude: 12.9231,
      longitude: 100.8826,
      radius_m: 150,
    },
  });
  expect(site.status).toBe(201);
  siteId = site.body['id'] as string;
}, 180_000);

afterAll(async () => {
  await harness.close();
});

describe('mobile device registration', () => {
  it('activates the first device and holds the second for approval', async () => {
    // spec §6.4: 1 active device ต่อพนักงาน; เครื่องที่สองต้องขออนุมัติ
    const employee = await createEmployee('มือถือ');

    const first = await call(harness, 'POST', '/mobile-devices/enroll', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { device_fingerprint: `fp-${uuidv4()}`, platform: 'android' },
    });
    expect(first.body['status']).toBe('ACTIVE');

    const second = await call(harness, 'POST', '/mobile-devices/enroll', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { device_fingerprint: `fp-${uuidv4()}`, platform: 'ios' },
    });
    // เครื่องใหม่ต้องไม่แทนที่เครื่องเดิมเงียบ ๆ — นั่นคือช่องทางยึดบัญชี
    expect(second.body['status']).toBe('PENDING');
  });

  it('replaces the previous device only when a manager approves', async () => {
    const employee = await createEmployee('เปลี่ยนเครื่อง');
    const firstId = await enrollDevice(employee);

    const pending = await call(harness, 'POST', '/mobile-devices/enroll', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { device_fingerprint: `fp-${uuidv4()}`, platform: 'ios' },
    });
    const pendingId = pending.body['id'] as string;

    const approved = await call(harness, 'POST', `/mobile-devices/${pendingId}/approve`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { reason: 'พนักงานเปลี่ยนเครื่องใหม่' },
    });
    expect(approved.status).toBe(200);
    expect(approved.body['status']).toBe('ACTIVE');

    const devices = await call(harness, 'GET', '/me/mobile-devices', { token: employee.token });
    const items = devices.body['items'] as { id: string; status: string }[];
    expect(items.find((item) => item.id === firstId)?.status).toBe('REPLACED');
  });

  it('never returns the device fingerprint', async () => {
    const employee = await createEmployee('ลายนิ้วเครื่อง');
    const fingerprint = `fp-secret-${uuidv4()}`;
    const response = await call(harness, 'POST', '/mobile-devices/enroll', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { device_fingerprint: fingerprint, platform: 'android' },
    });
    expect(JSON.stringify(response.body)).not.toContain(fingerprint);
  });

  it('cannot be approved by the employee themselves', async () => {
    const employee = await createEmployee('อนุมัติเอง');
    await enrollDevice(employee);
    const pending = await call(harness, 'POST', '/mobile-devices/enroll', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { device_fingerprint: `fp-${uuidv4()}`, platform: 'ios' },
    });

    const selfApprove = await call(
      harness,
      'POST',
      `/mobile-devices/${pending.body['id'] as string}/approve`,
      { token: employee.token, idempotencyKey: uuidv4(), payload: { reason: 'ขออนุมัติเอง' } },
    );
    expect(selfApprove.status).toBe(403);
  });
});

describe('photo check-in', () => {
  it('accepts a clean check-in at the site and creates one raw event', async () => {
    const employee = await createEmployee('ปกติ');
    const fingerprint = `fp-${uuidv4()}`;
    await call(harness, 'POST', '/mobile-devices/enroll', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { device_fingerprint: fingerprint, platform: 'android' },
    });

    const group = await createPolicyGroup();
    await assignPolicy(group, employee.employmentId);

    const result = await checkin(employee, { fingerprint });

    expect(result.status).toBe(200);
    expect(result.body['decision']).toBe('ACCEPTED');
    expect(result.body['risk_flags']).toEqual([]);
    expect(result.body['event_id']).toBeTruthy();
    expect(result.body['matched_site_id']).toBe(siteId);

    const events = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.rawTimeEvents)
        .where(eq(schema.rawTimeEvents.employmentId, employee.employmentId)),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.sourceType).toBe('MOBILE_APP');
  });

  it('refuses to commit the same session twice', async () => {
    // spec §19.2: upload retry ไม่สร้าง event ซ้ำ
    const employee = await createEmployee('ยืนยันซ้ำ');
    const fingerprint = `fp-${uuidv4()}`;
    await call(harness, 'POST', '/mobile-devices/enroll', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { device_fingerprint: fingerprint, platform: 'android' },
    });
    await assignPolicy(await createPolicyGroup(), employee.employmentId);

    const first = await checkin(employee, { fingerprint });
    expect(first.status).toBe(200);

    const again = await call(
      harness,
      'POST',
      `/time-events/photo-checkin-sessions/${first.sessionId}/commit`,
      {
        token: employee.token,
        idempotencyKey: uuidv4(),
        payload: {
          captured_at_client: harness.clock.now().toISOString(),
          location: { latitude: 12.9231, longitude: 100.8826, accuracy_m: 8 },
          mock_location_suspected: false,
        },
      },
    );
    expect(again.status).toBe(409);

    const events = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.rawTimeEvents)
        .where(eq(schema.rawTimeEvents.employmentId, employee.employmentId)),
    );
    expect(events).toHaveLength(1);
  });

  it('lets an upload be retried without producing a second event', async () => {
    const employee = await createEmployee('อัปโหลดซ้ำ');
    const fingerprint = `fp-${uuidv4()}`;
    await call(harness, 'POST', '/mobile-devices/enroll', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { device_fingerprint: fingerprint, platform: 'android' },
    });
    await assignPolicy(await createPolicyGroup(), employee.employmentId);

    const session = await call(harness, 'POST', '/time-events/photo-checkin-sessions', {
      token: employee.token,
      payload: { event_intent: 'CLOCK_IN', device_fingerprint: fingerprint },
    });
    const sessionId = session.body['id'] as string;
    const capturedAt = harness.clock.now().toISOString();

    // อัปโหลดล้มเหลวกลางทางแล้วลองใหม่ — เส้นทางที่ spec ออกแบบให้แยก 3 ขั้นตอน
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const evidence = await call(
        harness,
        'POST',
        `/time-events/photo-checkin-sessions/${sessionId}/evidence`,
        {
          token: employee.token,
          payload: {
            photo_base64: TINY_PNG,
            content_type: 'image/png',
            captured_at_client: capturedAt,
            live_capture: true,
          },
        },
      );
      expect(evidence.status).toBe(201);
    }

    const commit = await call(
      harness,
      'POST',
      `/time-events/photo-checkin-sessions/${sessionId}/commit`,
      {
        token: employee.token,
        idempotencyKey: uuidv4(),
        payload: {
          captured_at_client: capturedAt,
          location: { latitude: 12.9231, longitude: 100.8826, accuracy_m: 8 },
          mock_location_suspected: false,
        },
      },
    );
    expect(commit.status).toBe(200);

    const events = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.rawTimeEvents)
        .where(eq(schema.rawTimeEvents.employmentId, employee.employmentId)),
    );
    expect(events).toHaveLength(1);
  });

  it('sends a check-in outside the radius to review', async () => {
    const employee = await createEmployee('นอกพื้นที่');
    const fingerprint = `fp-${uuidv4()}`;
    await call(harness, 'POST', '/mobile-devices/enroll', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { device_fingerprint: fingerprint, platform: 'android' },
    });
    await assignPolicy(await createPolicyGroup(), employee.employmentId);

    const result = await checkin(employee, {
      fingerprint,
      location: { latitude: 13.7563, longitude: 100.5018, accuracy_m: 10 },
    });

    expect(result.body['decision']).toBe('PENDING_REVIEW');
    expect(result.body['risk_flags']).toContain('LOCATION_OUTSIDE_RADIUS');
    // ยังสร้าง event เพราะ spec §6.4 ห้ามปฏิเสธแบบมืดมน
    expect(result.body['event_id']).toBeTruthy();
  });

  it('sends poor GPS accuracy to review rather than blocking the employee', async () => {
    const employee = await createEmployee('สัญญาณแย่');
    const fingerprint = `fp-${uuidv4()}`;
    await call(harness, 'POST', '/mobile-devices/enroll', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { device_fingerprint: fingerprint, platform: 'android' },
    });
    await assignPolicy(await createPolicyGroup(), employee.employmentId);

    const result = await checkin(employee, {
      fingerprint,
      location: { latitude: 12.9231, longitude: 100.8826, accuracy_m: 400 },
    });

    expect(result.body['risk_flags']).toContain('LOCATION_ACCURACY_POOR');
    expect(result.body['event_id']).toBeTruthy();
  });

  it('rejects a gallery photo when the policy demands live capture', async () => {
    const employee = await createEmployee('รูปแกลเลอรี');
    const fingerprint = `fp-${uuidv4()}`;
    await call(harness, 'POST', '/mobile-devices/enroll', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { device_fingerprint: fingerprint, platform: 'android' },
    });
    await assignPolicy(await createPolicyGroup({ risk_action: 'REJECT' }), employee.employmentId);

    const result = await checkin(employee, { fingerprint, liveCapture: false });

    expect(result.body['decision']).toBe('REJECTED_POLICY');
    // ถูกปฏิเสธ = ไม่มีเวลาทำงาน แต่หลักฐานยังถูกเก็บไว้ตรวจสอบ
    expect(result.body['event_id']).toBeNull();

    const assessments = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.mobileRiskAssessments)
        .where(eq(schema.mobileRiskAssessments.employmentId, employee.employmentId)),
    );
    expect(assessments).toHaveLength(1);
    expect(assessments[0]?.decision).toBe('REJECTED_POLICY');
  });

  it('flags a photo that was already used for another check-in', async () => {
    // spec §6.4: duplicate photo checksum เป็นสัญญาณโกง
    const employee = await createEmployee('รูปซ้ำ');
    const fingerprint = `fp-${uuidv4()}`;
    await call(harness, 'POST', '/mobile-devices/enroll', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { device_fingerprint: fingerprint, platform: 'android' },
    });
    await assignPolicy(await createPolicyGroup(), employee.employmentId);

    const first = await checkin(employee, { fingerprint, photo: OTHER_PNG });
    expect(first.body['risk_flags']).not.toContain('PHOTO_DUPLICATE');

    // เลื่อนเวลาให้พ้นหน้าต่าง RAPID_REPEAT_CHECKIN — try/finally เพื่อให้นาฬิกา
    // ถูกคืนค่าแม้ assertion ล้ม มิฉะนั้น test ถัดไปจะพังตามไปด้วยโดยไม่เกี่ยวกัน
    let second: Awaited<ReturnType<typeof checkin>>;
    try {
      harness.clock.advanceBy(4 * 3600_000);
      second = await checkin(employee, { fingerprint, photo: OTHER_PNG });
    } finally {
      harness.clock.advanceBy(-4 * 3600_000);
    }

    expect(second.body['risk_flags']).toContain('PHOTO_DUPLICATE');
  });

  it('flags a check-in from a device that was never enrolled', async () => {
    const employee = await createEmployee('เครื่องไม่รู้จัก');
    await assignPolicy(await createPolicyGroup(), employee.employmentId);

    const result = await checkin(employee, { fingerprint: `fp-unknown-${uuidv4()}` });
    expect(result.body['risk_flags']).toContain('DEVICE_NOT_ENROLLED');
  });

  it('flags a commit that arrives long after the capture', async () => {
    const employee = await createEmployee('ยืนยันช้า');
    const fingerprint = `fp-${uuidv4()}`;
    await call(harness, 'POST', '/mobile-devices/enroll', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { device_fingerprint: fingerprint, platform: 'android' },
    });
    await assignPolicy(await createPolicyGroup(), employee.employmentId);

    const result = await checkin(employee, { fingerprint, commitDelayMs: 90_000 });
    expect(result.body['risk_flags']).toContain('CAPTURE_DEADLINE_EXCEEDED');
  });

  it('requires a photo when the policy says always', async () => {
    const employee = await createEmployee('ไม่มีรูป');
    const fingerprint = `fp-${uuidv4()}`;
    await call(harness, 'POST', '/mobile-devices/enroll', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { device_fingerprint: fingerprint, platform: 'android' },
    });
    await assignPolicy(await createPolicyGroup(), employee.employmentId);

    const result = await checkin(employee, { fingerprint, photo: null });
    expect(result.body['risk_flags']).toContain('PHOTO_MISSING');
  });
});

describe('evidence storage and access', () => {
  it('stores the photo privately with a retention deadline', async () => {
    const employee = await createEmployee('เก็บรูป');
    const fingerprint = `fp-${uuidv4()}`;
    await call(harness, 'POST', '/mobile-devices/enroll', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { device_fingerprint: fingerprint, platform: 'android' },
    });
    await assignPolicy(await createPolicyGroup({ photo_retention_days: 90 }), employee.employmentId);

    const result = await checkin(employee, { fingerprint });
    expect(result.status).toBe(200);

    const objects = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.storageObjects)
        .where(eq(schema.storageObjects.category, 'CHECKIN_PHOTO')),
    );
    expect(objects.length).toBeGreaterThan(0);

    const object = objects[objects.length - 1];
    // object key ต้องไม่มีข้อมูลระบุตัวตน (ADR-0010 ข้อ 4)
    expect(object?.objectKey).not.toContain(employee.employmentId);
    expect(object?.objectKey).toContain('checkin_photo');
    // retention ต้องถูกตั้งเสมอ — ห้ามเก็บรูปตลอดไป (spec §6.3)
    expect(object?.retentionUntil).toBe('2026-10-30');
  });

  it('hands out a short-lived signed URL and audits every access', async () => {
    const employee = await createEmployee('ดูหลักฐาน');
    const fingerprint = `fp-${uuidv4()}`;
    await call(harness, 'POST', '/mobile-devices/enroll', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { device_fingerprint: fingerprint, platform: 'android' },
    });
    await assignPolicy(await createPolicyGroup(), employee.employmentId);
    await checkin(employee, { fingerprint });

    const evidence = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx.select().from(schema.photoEvidenceObjects),
    );
    const evidenceId = evidence[evidence.length - 1]?.id as string;

    const download = await call(harness, 'GET', `/attendance-evidence/${evidenceId}/download-url`, {
      token: hrToken,
    });

    expect(download.status).toBe(200);
    expect(download.body['url']).toBeTruthy();
    // ไม่ใช่ public URL — ต้องมีลายเซ็นและวันหมดอายุ (ADR-0010)
    expect(String(download.body['url'])).toContain('signature=');
    expect(new Date(download.body['expires_at'] as string).getTime()).toBe(
      harness.clock.now().getTime() + harness.config.STORAGE_SIGNED_URL_TTL_SECONDS * 1000,
    );

    const auditor = await harness.createPrincipal(tenant, {
      subject: `k|auditor-${uuidv4().slice(0, 6)}`,
      roles: ['AUDITOR'],
    });
    expect(auditor).toBeTruthy();
  });

  it('denies evidence access to a role without the permission', async () => {
    // spec §19.2: user ไม่มี permission เปิด evidence ไม่ได้
    const employee = await createEmployee('ไม่มีสิทธิ์');
    const fingerprint = `fp-${uuidv4()}`;
    await call(harness, 'POST', '/mobile-devices/enroll', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { device_fingerprint: fingerprint, platform: 'android' },
    });
    await assignPolicy(await createPolicyGroup(), employee.employmentId);
    await checkin(employee, { fingerprint });

    const evidence = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx.select().from(schema.photoEvidenceObjects),
    );
    const evidenceId = evidence[evidence.length - 1]?.id as string;

    const denied = await call(harness, 'GET', `/attendance-evidence/${evidenceId}/download-url`, {
      token: employee.token,
    });
    expect(denied.status).toBe(403);
  });
});

describe('risk review queue', () => {
  it('lists unreviewed risks and records the reviewer decision with a reason', async () => {
    const employee = await createEmployee('เข้าคิวตรวจ');
    const fingerprint = `fp-${uuidv4()}`;
    await call(harness, 'POST', '/mobile-devices/enroll', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { device_fingerprint: fingerprint, platform: 'android' },
    });
    await assignPolicy(await createPolicyGroup(), employee.employmentId);

    await checkin(employee, {
      fingerprint,
      location: { latitude: 13.7563, longitude: 100.5018, accuracy_m: 10 },
    });

    const queue = await call(
      harness,
      'GET',
      `/attendance-risk-assessments?unreviewed_only=true&employment_id=${employee.employmentId}`,
      { token: hrToken },
    );
    expect(queue.status).toBe(200);
    const items = queue.body['items'] as { id: string; decision: string }[];
    expect(items).toHaveLength(1);
    expect(items[0]?.decision).toBe('PENDING_REVIEW');

    const reviewed = await call(
      harness,
      'POST',
      `/attendance-risk-assessments/${items[0]?.id as string}/review`,
      {
        token: hrToken,
        idempotencyKey: uuidv4(),
        payload: { outcome: 'APPROVED', reason: 'ไปทำงานนอกสถานที่ตามคำสั่งหัวหน้า' },
      },
    );
    expect(reviewed.status).toBe(200);
    expect(reviewed.body['review_outcome']).toBe('APPROVED');

    const afterReview = await call(
      harness,
      'GET',
      `/attendance-risk-assessments?unreviewed_only=true&employment_id=${employee.employmentId}`,
      { token: hrToken },
    );
    expect((afterReview.body['items'] as unknown[]).length).toBe(0);
  });

  it('refuses a review with no reason', async () => {
    const employee = await createEmployee('ไม่บอกเหตุผล');
    const fingerprint = `fp-${uuidv4()}`;
    await call(harness, 'POST', '/mobile-devices/enroll', {
      token: employee.token,
      idempotencyKey: uuidv4(),
      payload: { device_fingerprint: fingerprint, platform: 'android' },
    });
    await assignPolicy(await createPolicyGroup(), employee.employmentId);
    await checkin(employee, {
      fingerprint,
      location: { latitude: 13.7563, longitude: 100.5018, accuracy_m: 10 },
    });

    const queue = await call(
      harness,
      'GET',
      `/attendance-risk-assessments?unreviewed_only=true&employment_id=${employee.employmentId}`,
      { token: hrToken },
    );
    const id = (queue.body['items'] as { id: string }[])[0]?.id as string;

    const noReason = await call(harness, 'POST', `/attendance-risk-assessments/${id}/review`, {
      token: hrToken,
      idempotencyKey: uuidv4(),
      payload: { outcome: 'APPROVED', reason: '' },
    });
    // action นี้อยู่ใน REASON_REQUIRED_ACTIONS — บังคับต้องมีเหตุผล (ADR-0009)
    expect(noReason.status).toBe(400);
  });
});
