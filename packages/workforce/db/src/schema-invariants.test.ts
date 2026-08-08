import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from './client';
import { schemaTables } from './schema';
import { seedDemoTenant } from './seed/demo';
import { createTestDatabase, type TestDatabase } from './testing/harness';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

async function rows(text: string): Promise<Record<string, unknown>[]> {
  const result = await database.db.execute(sql.raw(text));
  return result.rows as Record<string, unknown>[];
}

describe('schema invariants', () => {
  it('applies every migration and records it', async () => {
    const applied = await rows('SELECT version, name, checksum FROM workforce.schema_migrations');
    expect(applied.length).toBeGreaterThan(0);
    expect(applied.every((row) => String(row['checksum']).length === 64)).toBe(true);
  });

  it('enables forced RLS on every table that carries tenant_id', async () => {
    // ยามกันลืม: เพิ่มตารางใหม่ที่มี tenant_id แล้วไม่ได้ประกาศ policy จะ fail ที่นี่
    // ไม่ใช่ตอน production รั่ว (ADR-0005 Consequences)
    const unprotected = await rows(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnum > 0
      WHERE n.nspname = 'workforce'
        AND c.relkind = 'r'
        AND (c.relrowsecurity = false OR c.relforcerowsecurity = false)
    `);

    const names = unprotected.map((row) => String(row['table_name'])).sort();
    // ตารางโครงสร้างพื้นฐานไม่มี RLS โดยเจตนา — เข้าถึงผ่าน service ที่ไม่รับ tenant จาก client
    expect(names).toEqual(['idempotency_keys', 'inbox_messages', 'jobs', 'outbox_messages']);
  });

  it('stores money as numeric(19,4) and returns it as a string', async () => {
    // ADR-0007: ถ้ามีใครตั้ง type parser ให้ numeric กลายเป็น number test นี้จะ fail
    const columns = await rows(`
      SELECT numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'workforce' AND table_name = 'compensation_rates' AND column_name = 'amount'
    `);
    expect(columns[0]).toMatchObject({ numeric_precision: 19, numeric_scale: 4 });

    const seed = await seedDemoTenant(database.db, { tenantCode: `money-${Date.now()}` });
    const amounts = await withTenant(database.db, seed.tenantId, async (tx) =>
      tx.select({ amount: schemaTables.compensationRates.amount }).from(schemaTables.compensationRates),
    );
    expect(amounts.length).toBeGreaterThan(0);
    for (const row of amounts) {
      expect(typeof row.amount).toBe('string');
    }
  });

  it('stores instants as timestamptz, not naive timestamps', async () => {
    // ระบบเดิมใช้ TIMESTAMP แล้วบวก 7 ชั่วโมงเอง (spec §3.3 A4)
    const naive = await rows(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'workforce' AND data_type = 'timestamp without time zone'
    `);
    expect(naive).toEqual([]);
  });

  it('keeps append-only tables free of UPDATE/DELETE grants', async () => {
    // ยามกัน migration ในอนาคตเขียน `GRANT ... ON ALL TABLES IN SCHEMA workforce`
    // ซึ่งจะคืนสิทธิ์เขียนทับให้ตารางที่ตั้งใจให้ append-only โดยไม่มีใครรู้
    const leaked = await rows(`
      SELECT table_name, privilege_type
      FROM information_schema.table_privileges
      WHERE table_schema = 'workforce'
        AND grantee = 'workforce_app'
        AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
        AND table_name IN ('audit_events', 'raw_time_events')
      ORDER BY table_name, privilege_type
    `);
    expect(leaked).toEqual([]);
  });

  it('never uses floating point for money-adjacent values', async () => {
    const floats = await rows(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'workforce' AND data_type IN ('real', 'double precision')
    `);
    expect(floats).toEqual([]);
  });
});

describe('tenant isolation', () => {
  it('hides another tenant rows even with a direct id lookup', async () => {
    const alpha = await seedDemoTenant(database.db, { tenantCode: `alpha-${Date.now()}` });
    const beta = await seedDemoTenant(database.db, { tenantCode: `beta-${Date.now()}` });

    const betaEmploymentId = beta.employmentIds[0] as string;

    const visible = await withTenant(database.db, alpha.tenantId, async (tx) => {
      const result = await tx.execute(
        sql`SELECT count(*)::int AS c FROM workforce.employments WHERE id = ${betaEmploymentId}`,
      );
      return Number((result.rows[0] as { c: number }).c);
    });

    expect(visible).toBe(0);
  });

  it('runs application statements as a role that cannot bypass RLS', async () => {
    // FORCE ROW LEVEL SECURITY ไม่มีผลกับ superuser — การลดสิทธิ์คือสิ่งที่ทำให้ policy มีผลจริง
    const identity = await withTenant(database.db, (await seedDemoTenant(database.db, { tenantCode: `role-${Date.now()}` })).tenantId, async (tx) => {
      const result = await tx.execute(sql`SELECT current_user AS role_name`);
      return (result.rows[0] as { role_name: string }).role_name;
    });
    expect(identity).toBe('workforce_app');
  });

  it('returns nothing when the tenant GUC is not set — fail closed', async () => {
    const seed = await seedDemoTenant(database.db, { tenantCode: `closed-${Date.now()}` });
    expect(seed.employmentIds.length).toBeGreaterThan(0);

    const visible = await database.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE workforce_app`);
      const result = await tx.execute(sql`SELECT count(*)::int AS c FROM workforce.employments`);
      return Number((result.rows[0] as { c: number }).c);
    });

    expect(visible).toBe(0);
  });
});

describe('immutability guards', () => {
  it('rejects UPDATE and DELETE on audit_events', async () => {
    const seed = await seedDemoTenant(database.db, { tenantCode: `audit-${Date.now()}` });

    await withTenant(database.db, seed.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO workforce.audit_events
          (id, tenant_id, occurred_at, actor_type, action, resource_type, outcome)
        VALUES (gen_random_uuid(), ${seed.tenantId}, now(), 'SYSTEM', 'test.write', 'test', 'SUCCESS')
      `);
    });

    await expect(
      withTenant(database.db, seed.tenantId, async (tx) => {
        await tx.execute(sql`UPDATE workforce.audit_events SET action = 'tampered'`);
      }),
    ).rejects.toThrow();

    await expect(
      withTenant(database.db, seed.tenantId, async (tx) => {
        await tx.execute(sql`DELETE FROM workforce.audit_events`);
      }),
    ).rejects.toThrow();

    const surviving = await withTenant(database.db, seed.tenantId, async (tx) => {
      const result = await tx.execute(sql`SELECT action FROM workforce.audit_events LIMIT 1`);
      return (result.rows[0] as { action: string }).action;
    });
    expect(surviving).toBe('test.write');
  });

  it('rejects overlapping effective periods for compensation', async () => {
    const seed = await seedDemoTenant(database.db, { tenantCode: `overlap-${Date.now()}` });
    const employmentId = seed.employmentIds[0] as string;

    await expect(
      withTenant(database.db, seed.tenantId, async (tx) => {
        await tx.execute(sql`
          INSERT INTO workforce.compensation_rates
            (id, tenant_id, employment_id, pay_basis, amount, effective_from)
          VALUES (gen_random_uuid(), ${seed.tenantId}, ${employmentId}, 'MONTHLY', 40000, '2026-06-01')
        `);
      }),
    ).rejects.toThrow(/overlaps/);
  });

  it('allows a non-overlapping successor period', async () => {
    const seed = await seedDemoTenant(database.db, { tenantCode: `succ-${Date.now()}`, asOf: '2026-01-01' });
    const employmentId = seed.employmentIds[0] as string;

    await withTenant(database.db, seed.tenantId, async (tx) => {
      await tx.execute(sql`
        UPDATE workforce.compensation_rates SET effective_to = '2026-07-31'
        WHERE employment_id = ${employmentId} AND effective_to IS NULL
      `);
      await tx.execute(sql`
        INSERT INTO workforce.compensation_rates
          (id, tenant_id, employment_id, pay_basis, amount, effective_from)
        VALUES (gen_random_uuid(), ${seed.tenantId}, ${employmentId}, 'MONTHLY', 35000, '2026-08-01')
      `);
    });

    const history = await withTenant(database.db, seed.tenantId, async (tx) => {
      const result = await tx.execute(sql`
        SELECT amount::text AS amount FROM workforce.compensation_rates
        WHERE employment_id = ${employmentId} ORDER BY effective_from
      `);
      return result.rows as { amount: string }[];
    });

    // ประวัติเดิมยังอยู่ครบ — ไม่ถูกเขียนทับเหมือน fp_users.base_salary ของระบบเดิม
    expect(history).toHaveLength(2);
    expect(history.map((row) => row.amount)).toEqual(['32000.0000', '35000.0000']);
  });

  it('rejects a second open-ended compensation row', async () => {
    const seed = await seedDemoTenant(database.db, { tenantCode: `open-${Date.now()}` });
    const employmentId = seed.employmentIds[0] as string;

    await expect(
      withTenant(database.db, seed.tenantId, async (tx) => {
        await tx.execute(sql`
          INSERT INTO workforce.compensation_rates
            (id, tenant_id, employment_id, pay_basis, amount, effective_from)
          VALUES (gen_random_uuid(), ${seed.tenantId}, ${employmentId}, 'MONTHLY', 40000, '2030-01-01')
        `);
      }),
    ).rejects.toThrow();
  });
});
