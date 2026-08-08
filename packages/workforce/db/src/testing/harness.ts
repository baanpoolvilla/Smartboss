import { sql } from 'drizzle-orm';
import { createPgliteDatabase, createPostgresDatabase, type Db, type DatabaseHandle } from '../client';
import { migrate } from '../migrator';

export interface TestDatabase {
  readonly db: Db;
  readonly driver: DatabaseHandle['driver'];
  /** ล้างข้อมูลทุกตารางแต่คง schema ไว้ — เร็วกว่าสร้าง DB ใหม่ทุก test */
  truncateAll(): Promise<void>;
  close(): Promise<void>;
}

const BUSINESS_TABLES = [
  'audit_events',
  'principal_role_assignments',
  'role_permissions',
  'roles',
  'principals',
  'compensation_rates',
  'employment_assignments',
  'employments',
  'people',
  'positions',
  'sites',
  'org_units',
  'companies',
  'tenants',
  'storage_objects',
  'idempotency_keys',
  'outbox_messages',
  'inbox_messages',
  'jobs',
] as const;

/**
 * สร้างฐานข้อมูลสำหรับ test
 *
 * ไม่ตั้ง `TEST_DATABASE_URL` → PGlite in-memory (ไม่ต้องมี Docker — ADR-0011)
 * ตั้งไว้ → PostgreSQL จริง (CI ใช้เส้นทางนี้เพื่อยืนยันสิ่งที่ PGlite ต่างออกไป)
 */
export async function createTestDatabase(
  options: { connectionString?: string } = {},
): Promise<TestDatabase> {
  const connectionString = options.connectionString ?? process.env['TEST_DATABASE_URL'];

  const handle =
    connectionString === undefined || connectionString === ''
      ? createPgliteDatabase()
      : createPostgresDatabase({ connectionString, poolMax: 4 });

  await migrate(handle);

  return {
    db: handle.db,
    driver: handle.driver,
    truncateAll: async () => {
      // TRUNCATE ไม่ผ่าน RLS จึงล้างข้ามทุก tenant ได้โดยไม่ต้องตั้ง GUC
      const list = BUSINESS_TABLES.map((table) => `workforce.${table}`).join(', ');
      await handle.db.execute(sql.raw(`TRUNCATE ${list} RESTART IDENTITY CASCADE`));
    },
    close: handle.close,
  };
}
