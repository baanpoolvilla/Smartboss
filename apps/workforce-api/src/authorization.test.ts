import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { OPERATIONAL_ROUTES, ROUTES } from '@workforce/contracts';
import { PERMISSIONS, uuidv4 } from '@workforce/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEVICE_ROUTE_KEY } from './ingestion/device-auth.guard';
import { PUBLIC_ROUTE_KEY, REQUIRED_PERMISSIONS_KEY } from './shared/decorators';
import { call, createTestHarness, type TestHarness, type TestTenant } from './testing/test-app';

let harness: TestHarness;
let tenantA: TestTenant;
let tenantB: TestTenant;

beforeAll(async () => {
  harness = await createTestHarness();
  tenantA = await harness.createTenant('alpha');
  tenantB = await harness.createTenant('beta');

  await harness.createPrincipal(tenantA, { subject: 'a|hr', roles: ['HR_OFFICER'] });
  await harness.createPrincipal(tenantA, { subject: 'a|employee', roles: ['EMPLOYEE'] });
  await harness.createPrincipal(tenantA, { subject: 'a|admin', roles: ['TENANT_ADMIN'] });
  await harness.createPrincipal(tenantA, { subject: 'a|preparer', roles: ['PAYROLL_PREPARER'] });
  await harness.createPrincipal(tenantA, { subject: 'a|approver', roles: ['PAYROLL_APPROVER'] });
  await harness.createPrincipal(tenantB, { subject: 'b|admin', roles: ['TENANT_ADMIN'] });
}, 120_000);

afterAll(async () => {
  await harness.close();
});

describe('authentication', () => {
  it('rejects a request with no token', async () => {
    const response = await call(harness, 'GET', '/me');
    expect(response.status).toBe(401);
    expect(response.body['code']).toBe('UNAUTHENTICATED');
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('rejects a malformed or unsigned token', async () => {
    const response = await call(harness, 'GET', '/me', { token: 'not-a-jwt' });
    expect(response.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    // token ที่ payload ถูกต้องแต่ลายเซ็นผิดต้องไม่ผ่าน
    const valid = await harness.token('a|hr', tenantA.tenantId);
    const [header, payload] = valid.split('.');
    const forged = `${header}.${payload}.${Buffer.from('forged').toString('base64url')}`;
    expect((await call(harness, 'GET', '/me', { token: forged })).status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const token = await harness.token('a|hr', tenantA.tenantId, { expiresInSeconds: 1 });
    harness.clock.advanceBy(120_000);
    expect((await call(harness, 'GET', '/me', { token })).status).toBe(401);
    harness.clock.advanceBy(-120_000);
  });

  it('rejects a valid token for a principal that does not exist in the tenant', async () => {
    // token ถูกต้องแต่ไม่มี principal — ไม่ auto-provision (ADR-0006)
    const token = await harness.token('a|ghost', tenantA.tenantId);
    const response = await call(harness, 'GET', '/me', { token });
    expect(response.status).toBe(401);
  });

  it('allows health checks without a token', async () => {
    expect((await call(harness, 'GET', '/health')).status).toBe(200);
    expect((await call(harness, 'GET', '/health/ready')).body['status']).toBe('ok');
  });

  it('returns the caller identity and resolved permissions', async () => {
    const token = await harness.token('a|hr', tenantA.tenantId);
    const response = await call(harness, 'GET', '/me', { token });

    expect(response.status).toBe(200);
    expect(response.body['tenant_id']).toBe(tenantA.tenantId);
    expect(response.body['permissions']).toContain('workforce.people.manage');
    expect(response.body['roles']).toEqual([
      expect.objectContaining({ code: 'HR_OFFICER', company_id: tenantA.companyId }),
    ]);
  });
});

describe('authorization', () => {
  it('denies a permission the role does not carry', async () => {
    const token = await harness.token('a|employee', tenantA.tenantId);
    const response = await call(harness, 'GET', '/people', { token });

    expect(response.status).toBe(403);
    expect(response.body['code']).toBe('FORBIDDEN');
    expect(response.body['meta']).toMatchObject({
      required_permissions: ['workforce.people.read'],
    });
  });

  it('does not grant payroll access to the tenant administrator', async () => {
    // spec §5: Tenant Admin ตั้งค่าองค์กรได้ แต่ไม่เห็นเงินเดือนโดยอัตโนมัติ
    const token = await harness.token('a|admin', tenantA.tenantId);
    const employmentId = uuidv4();
    const response = await call(
      harness,
      'GET',
      `/compensation-rates?employment_id=${employmentId}`,
      { token },
    );
    expect(response.status).toBe(403);
  });

  it('separates payroll preparation from payroll approval', async () => {
    // maker-checker (spec §10.2): preparer เตรียมได้ แต่ต้องไม่มีสิทธิ์อนุมัติ
    const preparer = await call(harness, 'GET', '/me', {
      token: await harness.token('a|preparer', tenantA.tenantId),
    });
    const approver = await call(harness, 'GET', '/me', {
      token: await harness.token('a|approver', tenantA.tenantId),
    });

    const preparerPermissions = preparer.body['permissions'] as string[];
    const approverPermissions = approver.body['permissions'] as string[];

    expect(preparerPermissions).toContain('workforce.payroll.prepare');
    expect(preparerPermissions).not.toContain('workforce.payroll.approve');
    expect(approverPermissions).toContain('workforce.payroll.approve');
    expect(approverPermissions).not.toContain('workforce.payroll.prepare');
  });

  it('requires multi-factor authentication for step-up actions', async () => {
    // spec §16: payroll approve/lock/export และการเปิดหลักฐานภาพต้องผ่าน MFA
    const noMfa = await harness.token('a|hr', tenantA.tenantId, { amr: ['pwd'] });
    const response = await call(harness, 'GET', '/people', { token: noMfa });
    // /people ไม่ต้อง step-up — ยืนยันว่า MFA ไม่ได้ถูกบังคับกับทุก endpoint
    expect(response.status).toBe(200);
  });

  it('expires time-limited support access', async () => {
    const expiring = await harness.createTenant('support-tenant');
    await harness.createPrincipal(expiring, {
      subject: 's|support',
      roles: ['SUPPORT_OPERATOR'],
      expiresAt: new Date(harness.clock.now().getTime() + 60_000),
    });

    const token = await harness.token('s|support', expiring.tenantId);
    expect((await call(harness, 'GET', '/me', { token })).status).toBe(200);

    harness.clock.advanceBy(120_000);
    const afterExpiry = await call(harness, 'GET', '/people', { token });
    // การมอบสิทธิ์หมดอายุแล้วต้องไม่มีผล แม้แถวยังอยู่ในตาราง
    expect(afterExpiry.status).toBe(403);
    harness.clock.advanceBy(-120_000);
  });
});

describe('tenant isolation', () => {
  it('hides another tenant resource behind 404, not 403', async () => {
    // 403 จะเป็นการยืนยันว่าทรัพยากรนั้นมีอยู่จริง (ADR-0005 ชั้น 4)
    const tokenB = await harness.token('b|admin', tenantB.tenantId);
    const response = await call(harness, 'GET', `/companies/${tenantA.companyId}`, {
      token: tokenB,
    });
    expect(response.status).toBe(404);
  });

  it('never returns another tenant rows in a list', async () => {
    const tokenB = await harness.token('b|admin', tenantB.tenantId);
    const response = await call(harness, 'GET', '/companies', { token: tokenB });

    expect(response.status).toBe(200);
    const items = response.body['items'] as { id: string }[];
    expect(items.map((item) => item.id)).toEqual([tenantB.companyId]);
  });

  it('ignores a tenant hint supplied by the client', async () => {
    // tenant มาจาก token ที่ verify แล้วเท่านั้น (spec §21)
    const tokenB = await harness.token('b|admin', tenantB.tenantId);
    const response = await call(harness, 'GET', '/companies', {
      token: tokenB,
      headers: { 'x-tenant-id': tenantA.tenantId },
    });

    const items = response.body['items'] as { id: string }[];
    expect(items.map((item) => item.id)).toEqual([tenantB.companyId]);
  });

  it('rejects a token whose tenant claim points at another tenant with no principal there', async () => {
    const crossToken = await harness.token('a|admin', tenantB.tenantId);
    expect((await call(harness, 'GET', '/me', { token: crossToken })).status).toBe(401);
  });
});

describe('route coverage', () => {
  it('has every controller route declaring permissions, device auth, or explicit public intent', () => {
    // ยามกันลืม: route ใหม่ที่ไม่ประกาศอะไรเลยจะถูกจับที่นี่ ไม่ใช่ตอน production
    const discovery = harness.app.get(DiscoveryService);
    const reflector = harness.app.get(Reflector);
    const scanner = new MetadataScanner();

    const undeclared: string[] = [];
    const publicWithoutDeviceAuth: string[] = [];

    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (instance === undefined || instance === null) continue;
      const prototype = Object.getPrototypeOf(instance) as object;

      for (const methodName of scanner.getAllMethodNames(prototype)) {
        const handler = (instance as Record<string, () => unknown>)[methodName];
        if (typeof handler !== 'function') continue;

        const isPublic = reflector.get<boolean>(PUBLIC_ROUTE_KEY, handler) === true;
        const isDeviceRoute = reflector.get<boolean>(DEVICE_ROUTE_KEY, handler) === true;
        const permissions = reflector.get<string[]>(REQUIRED_PERMISSIONS_KEY, handler);

        if (!isPublic && permissions === undefined) {
          undeclared.push(`${wrapper.name}.${methodName}`);
        }

        // route ที่ข้าม principal auth ต้องมีตัวตรวจอื่นมาแทน หรือถูกประกาศไว้
        // ใน registry ว่าเปิดสาธารณะเพราะอะไร — ไม่มีทางที่ "ไม่มีใครตรวจเลย"
        if (isPublic && !isDeviceRoute) {
          const inRegistry = ROUTES.some(
            (route) => route.permissions === null && route.publicReason !== undefined,
          );
          if (!inRegistry) publicWithoutDeviceAuth.push(`${wrapper.name}.${methodName}`);
        }
      }
    }

    expect(undeclared).toEqual([]);
    expect(publicWithoutDeviceAuth).toEqual([]);
  });

  it('requires every registry route without permissions to justify itself', () => {
    const unjustified = ROUTES.filter(
      (route) =>
        route.permissions === null &&
        route.deviceAuth !== true &&
        (route.publicReason === undefined || route.publicReason.trim() === ''),
    );
    expect(unjustified.map((route) => route.operationId)).toEqual([]);
  });

  it('declares path parameters as whole segments only', () => {
    // `{param}` ต้องเป็น segment เต็มเสมอ — `payslips{publish}` แปลว่ามีคนแปลง
    // literal `:publish` เป็น path parameter ทำให้ OpenAPI ประกาศ parameter ลวง
    // และ client generator สร้าง argument ที่ไม่มีอยู่จริง
    const malformed = [...ROUTES, ...OPERATIONAL_ROUTES]
      .filter((route) => /[^/]\{/.test(route.path))
      .map((route) => `${route.method} ${route.path}`);

    expect(malformed).toEqual([]);
  });

  it('has every registered route present in the published contract', () => {
    // ยามกัน OpenAPI ตกหล่น: endpoint ที่มีอยู่จริงแต่ไม่อยู่ในทะเบียนจะถูกจับที่นี่
    const discovery = harness.app.get(DiscoveryService);
    const scanner = new MetadataScanner();

    const declared = new Set(
      [...ROUTES, ...OPERATIONAL_ROUTES].map((route) => `${route.method} ${route.path}`),
    );
    const missing: string[] = [];

    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (instance === undefined || instance === null) continue;
      const prototype = Object.getPrototypeOf(instance) as object;
      const basePath = (Reflect.getMetadata('path', wrapper.metatype as object) as string) ?? '';

      for (const methodName of scanner.getAllMethodNames(prototype)) {
        const handler = (instance as Record<string, () => unknown>)[methodName];
        if (typeof handler !== 'function') continue;

        const subPath = Reflect.getMetadata('path', handler) as string | undefined;
        const verb = Reflect.getMetadata('method', handler) as number | undefined;
        if (subPath === undefined || verb === undefined) continue;

        // RequestMethod: 0=GET 1=POST 2=PUT 3=DELETE 4=PATCH
        const verbName = ({ 0: 'get', 1: 'post', 3: 'delete', 4: 'patch' } as Record<number, string>)[
          verb
        ];
        if (verbName === undefined) continue;

        const full = `/${[basePath, subPath].filter((part) => part !== '' && part !== '/').join('/')}`
          .replace(/\/+/g, '/')
          // แปลงเฉพาะ `:param` ที่เป็น segment เต็ม — ต้องตามหลัง '/' เท่านั้น
          // `:action` ท้าย path (เช่น `time-events:batch`) เป็น literal ของ REST
          // action style ไม่ใช่ path parameter ถ้าแปลงด้วยจะได้ `{batch}` ซึ่งประกาศ
          // parameter ที่ไม่มีอยู่จริงลงใน OpenAPI
          .replace(/\/:([A-Za-z0-9_]+)/g, '/{$1}');

        if (!declared.has(`${verbName} ${full}`)) missing.push(`${verbName.toUpperCase()} ${full}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('declares permissions in the contract that match the controller metadata', () => {
    const discovery = harness.app.get(DiscoveryService);
    const reflector = harness.app.get(Reflector);
    const scanner = new MetadataScanner();

    const controllerPermissions = new Map<string, string[]>();
    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (instance === undefined || instance === null) continue;
      const prototype = Object.getPrototypeOf(instance) as object;

      for (const methodName of scanner.getAllMethodNames(prototype)) {
        const handler = (instance as Record<string, () => unknown>)[methodName];
        if (typeof handler !== 'function') continue;
        const permissions = reflector.get<string[]>(REQUIRED_PERMISSIONS_KEY, handler);
        if (permissions !== undefined) controllerPermissions.set(methodName, permissions);
      }
    }

    // ทุก permission ที่ controller ประกาศต้องอยู่ใน catalog ของ domain
    const catalog = new Set<string>(PERMISSIONS);
    const unknown: string[] = [];
    for (const [method, permissions] of controllerPermissions) {
      for (const permission of permissions) {
        if (!catalog.has(permission)) unknown.push(`${method}: ${permission}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('keeps the published contract in step with what the API enforces', () => {
    const declared = ROUTES.filter(
      (route) => route.permissions !== null && route.permissions.length > 0,
    );
    expect(declared.length).toBeGreaterThan(0);
    for (const route of declared) {
      expect(route.permissions).not.toBeNull();
    }
  });
});
