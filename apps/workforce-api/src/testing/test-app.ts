import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { loadConfig, type AppConfig } from '@workforce/config';
import {
  createTestDatabase,
  seedSystemRoles,
  withTenant,
  schema,
  type DatabaseHandle,
  type TestDatabase,
} from '@workforce/db';
import {
  FixedClock,
  uuidv7,
  type SystemRole,
} from '@workforce/domain';
import { SignJWT } from 'jose';
import { AppModule } from '../app.module';
import { configureApplication } from '../bootstrap';
import { APP_CONFIG, CLOCK, DATABASE_HANDLE } from '../shared/tokens';

const TEST_SIGNING_SECRET = 'test-signing-secret-that-is-long-enough-32';

export interface TestTenant {
  tenantId: string;
  companyId: string;
  roleIds: Map<SystemRole, string>;
}

export interface TokenOptions {
  /** ค่าเริ่มต้นมี mfa เพื่อให้ทดสอบเส้นทางปกติได้; ส่ง [] เพื่อทดสอบ step-up */
  amr?: string[];
  authTimeOffsetSeconds?: number;
  expiresInSeconds?: number;
  tenantId?: string;
}

export interface TestHarness {
  app: NestFastifyApplication;
  database: TestDatabase;
  clock: FixedClock;
  config: AppConfig;
  createTenant(code?: string): Promise<TestTenant>;
  createPrincipal(
    tenant: TestTenant,
    options: { subject: string; roles: SystemRole[]; personId?: string; expiresAt?: Date },
  ): Promise<string>;
  token(subject: string, tenantId: string, options?: TokenOptions): Promise<string>;
  close(): Promise<void>;
}

/**
 * สร้าง API จริงบน PGlite — ไม่ mock ชั้นใดเลยระหว่าง HTTP กับ SQL
 *
 * เจตนาให้ integration test เดินผ่าน guard, interceptor, RLS, trigger และ constraint
 * ตัวจริงทั้งหมด เพราะ invariant ที่สำคัญที่สุดของระบบนี้อยู่ในชั้นเหล่านั้น (ADR-0011)
 */
export async function createTestHarness(): Promise<TestHarness> {
  const database = await createTestDatabase();
  const clock = new FixedClock('2026-08-01T02:00:00.000Z');

  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://unused@localhost/unused',
    AUTH_PROVIDER: 'local',
    AUTH_LOCAL_SIGNING_SECRET: TEST_SIGNING_SECRET,
    STORAGE_DRIVER: 'filesystem',
    STORAGE_FILESYSTEM_ROOT: mkdtempSync(join(tmpdir(), 'workforce-storage-')),
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
  });

  const handle: DatabaseHandle = {
    db: database.db,
    driver: database.driver,
    withRawSession: async () => {
      throw new Error('raw sessions are not available in tests');
    },
    close: async () => undefined,
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(DATABASE_HANDLE)
    .useValue(handle)
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();

  // rawBody จำเป็นต่อการตรวจลายเซ็นของเครื่อง — ต้องเซ็นบน byte ดิบ ไม่ใช่ JSON ที่ parse แล้ว
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  configureApplication(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const harness: TestHarness = {
    app,
    database,
    clock,
    config,

    createTenant: async (code = `t-${uuidv7().slice(0, 8)}`) => {
      const tenantId = uuidv7();
      const companyId = uuidv7();

      const roleIds = await withTenant(database.db, tenantId, async (tx) => {
        await tx.insert(schema.tenants).values({ id: tenantId, code, name: `Tenant ${code}` });
        await tx.insert(schema.companies).values({
          id: companyId,
          tenantId,
          code: 'MAIN',
          legalName: `${code} Co., Ltd.`,
          displayName: code,
        });
        return seedSystemRoles(tx, tenantId);
      });

      return { tenantId, companyId, roleIds };
    },

    createPrincipal: async (tenant, options) => {
      const principalId = uuidv7();
      await withTenant(database.db, tenant.tenantId, async (tx) => {
        await tx.insert(schema.principals).values({
          id: principalId,
          tenantId: tenant.tenantId,
          subject: options.subject,
          displayName: options.subject,
          personId: options.personId ?? null,
        });

        for (const role of options.roles) {
          const roleId = tenant.roleIds.get(role);
          if (roleId === undefined) throw new Error(`unknown system role: ${role}`);
          await tx.insert(schema.principalRoleAssignments).values({
            id: uuidv7(),
            tenantId: tenant.tenantId,
            principalId,
            roleId,
            companyId: tenant.companyId,
            expiresAt: options.expiresAt ?? null,
            reason: 'test fixture',
          });
        }
      });
      return principalId;
    },

    token: async (subject, tenantId, options = {}) => {
      const nowSeconds = Math.floor(clock.now().getTime() / 1000);
      const authTime = nowSeconds - (options.authTimeOffsetSeconds ?? 0);

      return new SignJWT({
        'wf:tenant': options.tenantId ?? tenantId,
        amr: options.amr ?? ['pwd', 'mfa'],
        auth_time: authTime,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(subject)
        .setIssuer('workforce-local')
        .setAudience('workforce-api')
        .setIssuedAt(nowSeconds)
        // อายุยาวพอครอบคลุมกะทำงานหนึ่งกะ — test ที่เลื่อนนาฬิกาไปข้างหน้าไม่กี่ชั่วโมง
        // จึงไม่ล้มด้วย 401 โดยไม่เกี่ยวกับสิ่งที่กำลังทดสอบ
        .setExpirationTime(nowSeconds + (options.expiresInSeconds ?? 8 * 3600))
        .sign(new TextEncoder().encode(TEST_SIGNING_SECRET));
    },

    close: async () => {
      await app.close();
      await database.close();
    },
  };

  return harness;
}

export const BASE = '/api/workforce/v1';

export interface RequestOptions {
  token?: string;
  /** ส่ง body เป็นสตริงดิบ เพื่อให้ byte ที่เซ็นกับ byte ที่ส่งตรงกันเป๊ะ */
  rawPayload?: string;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

export async function call(
  harness: TestHarness,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  options: RequestOptions & { payload?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown>; headers: Record<string, unknown> }> {
  const response = await harness.app.inject({
    method,
    url: `${BASE}${path}`,
    ...(options.rawPayload !== undefined
      ? { payload: options.rawPayload }
      : options.payload === undefined
        ? {}
        : { payload: options.payload as object }),
    headers: {
      ...(options.rawPayload === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
      ...(options.idempotencyKey === undefined
        ? {}
        : { 'idempotency-key': options.idempotencyKey }),
      ...(options.headers ?? {}),
    },
  });

  let body: Record<string, unknown> = {};
  if (response.body.length > 0) {
    try {
      body = JSON.parse(response.body) as Record<string, unknown>;
    } catch {
      body = { raw: response.body };
    }
  }

  return { status: response.statusCode, body, headers: response.headers };
}
