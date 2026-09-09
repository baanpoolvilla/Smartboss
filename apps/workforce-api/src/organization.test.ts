import { schema, withTenant } from '@workforce/db';
import { uuidv4 } from '@workforce/domain';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createTestHarness, type TestHarness, type TestTenant } from './testing/test-app';

let harness: TestHarness;
let tenant: TestTenant;
/** workforce.settings.manage — คนที่ตั้งค่าสถานที่ได้ */
let adminToken: string;
/** workforce.people.read เท่านั้น — อ่านได้ แก้ไม่ได้ */
let readerToken: string;

async function createSite(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await call(harness, 'POST', '/sites', {
    token: adminToken,
    idempotencyKey: uuidv4(),
    payload: {
      company_id: tenant.companyId,
      code: `S-${uuidv4().slice(0, 8)}`,
      name: 'ไซต์ทดสอบ',
      latitude: 13.7563,
      longitude: 100.5018,
      radius_m: 200,
      ...overrides,
    },
  });
  expect(response.status).toBe(201);
  return response.body['id'] as string;
}

beforeAll(async () => {
  harness = await createTestHarness();
  tenant = await harness.createTenant('org');

  await harness.createPrincipal(tenant, { subject: 'o|admin', roles: ['TENANT_ADMIN'] });
  await harness.createPrincipal(tenant, { subject: 'o|reader', roles: ['AUDITOR'] });

  adminToken = await harness.token('o|admin', tenant.tenantId);
  readerToken = await harness.token('o|reader', tenant.tenantId);
}, 120_000);

afterAll(async () => {
  await harness.close();
});

describe('sites — แก้ไขสถานที่ (PATCH /sites/:siteId)', () => {
  it('ย้ายหมุดและแก้รัศมีได้ แล้ว version เดินหน้า', async () => {
    const siteId = await createSite();

    const response = await call(harness, 'PATCH', `/sites/${siteId}`, {
      token: adminToken,
      payload: { latitude: 12.9231, longitude: 100.8826, radius_m: 150 },
    });

    expect(response.status).toBe(200);
    // latitude/longitude เก็บเป็น numeric(9,6) ⇒ ออกมาเป็นสตริงที่มีทศนิยม 6 ตำแหน่ง
    expect(response.body['latitude']).toBe('12.923100');
    expect(response.body['longitude']).toBe('100.882600');
    expect(response.body['radius_m']).toBe(150);
    // trigger sites_touch ต้องเดิน version ให้ ไม่ใช่ค้างที่ 1
    expect(response.body['version']).toBe(2);
  });

  it('แก้ชื่อกับสถานะได้ โดยไม่แตะพิกัดเดิม', async () => {
    const siteId = await createSite({ name: 'ชื่อเดิม' });

    const response = await call(harness, 'PATCH', `/sites/${siteId}`, {
      token: adminToken,
      payload: { name: 'ชื่อใหม่', status: 'INACTIVE' },
    });

    expect(response.status).toBe(200);
    expect(response.body['name']).toBe('ชื่อใหม่');
    expect(response.body['status']).toBe('INACTIVE');
    expect(response.body['latitude']).toBe('13.756300');
    expect(response.body['longitude']).toBe('100.501800');
  });

  it('ล้างหมุดทิ้งได้ด้วยการส่ง null ทั้งคู่', async () => {
    const siteId = await createSite();

    const response = await call(harness, 'PATCH', `/sites/${siteId}`, {
      token: adminToken,
      payload: { latitude: null, longitude: null },
    });

    expect(response.status).toBe(200);
    expect(response.body['latitude']).toBeNull();
    expect(response.body['longitude']).toBeNull();
  });

  it('ปฏิเสธเมื่อส่งพิกัดมาข้างเดียว — หมุดเพี้ยนแบบเงียบ ๆ คือสิ่งที่ต้องกัน', async () => {
    const siteId = await createSite();

    const response = await call(harness, 'PATCH', `/sites/${siteId}`, {
      token: adminToken,
      payload: { latitude: 14.1 },
    });

    // zodPipe ตอบ 400 สำหรับ body ที่ validate ไม่ผ่าน
    expect(response.status).toBe(400);

    // ของเดิมต้องไม่ขยับ
    const after = await call(harness, 'GET', `/sites/${siteId}`, { token: adminToken });
    expect(after.body['latitude']).toBe('13.756300');
  });

  it('ไม่ยอมให้ย้ายสถานที่ข้ามนิติบุคคลหรือเปลี่ยน code', async () => {
    const siteId = await createSite({ code: 'FIXED-CODE' });

    const response = await call(harness, 'PATCH', `/sites/${siteId}`, {
      token: adminToken,
      payload: { company_id: uuidv4(), code: 'HACKED' },
    });

    // zod strip ฟิลด์ที่ไม่รู้จักออก ⇒ คำขอผ่านแต่ต้องไม่มีผลอะไรเลย
    expect(response.status).toBe(200);
    expect(response.body['code']).toBe('FIXED-CODE');
    expect(response.body['company_id']).toBe(tenant.companyId);
  });

  it('ตอบ 404 เมื่อไม่มีสถานที่นั้น และ 400 เมื่อ id ไม่ใช่ uuid', async () => {
    const missing = await call(harness, 'PATCH', `/sites/${uuidv4()}`, {
      token: adminToken,
      payload: { name: 'ไม่มีจริง' },
    });
    expect(missing.status).toBe(404);

    const malformed = await call(harness, 'PATCH', '/sites/not-a-uuid', {
      token: adminToken,
      payload: { name: 'x' },
    });
    expect(malformed.status).toBe(400);
  });

  it('คนที่อ่านได้อย่างเดียวแก้ไม่ได้', async () => {
    const siteId = await createSite();

    const response = await call(harness, 'PATCH', `/sites/${siteId}`, {
      token: readerToken,
      payload: { radius_m: 5000 },
    });

    expect(response.status).toBe(403);
  });

  it('ลง audit ทั้งพิกัดก่อนและหลัง — ต้องย้อนได้ว่าตอนนั้นหมุดอยู่ที่ไหน', async () => {
    const siteId = await createSite();

    await call(harness, 'PATCH', `/sites/${siteId}`, {
      token: adminToken,
      payload: { latitude: 18.7883, longitude: 98.9853, radius_m: 80 },
    });

    const rows = await withTenant(harness.database.db, tenant.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.resourceType, 'site'),
            eq(schema.auditEvents.resourceId, siteId),
            eq(schema.auditEvents.action, 'organization.site.update'),
          ),
        ),
    );

    expect(rows).toHaveLength(1);
    const entry = rows[0] as { before: unknown; after: unknown };
    expect(entry.before).toMatchObject({ latitude: '13.756300', radius_m: 200 });
    expect(entry.after).toMatchObject({ latitude: '18.788300', radius_m: 80 });
  });
});
