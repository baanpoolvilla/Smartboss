import { sql } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { schemaTables } from './schema';

/**
 * Handle ของ drizzle ที่ใช้ทั่วทั้งระบบ
 *
 * node-postgres และ PGlite ใช้ base class เดียวกัน (`PgDatabase`) และมี API
 * ที่เราใช้เหมือนกันทุกตัว จึงตั้ง type เป็นตัวใดตัวหนึ่งแล้ว cast ที่จุดสร้าง
 * เพียงจุดเดียว แทนที่จะให้ repository ทุกตัวต้องรับ union type (ADR-0011)
 */
export type Db = PgliteDatabase<typeof schemaTables>;

/** transaction handle — API เหมือน Db แต่แยก type ไว้ให้อ่านโค้ดง่าย */
export type Tx = Db;

/**
 * Session ระดับล่างสำหรับงานที่ query builder ทำไม่ได้ — ปัจจุบันคือ migration
 *
 * `exec` ใช้ simple query protocol จึงรัน script หลายคำสั่งในครั้งเดียวได้
 * (extended protocol ที่ drizzle ใช้ตามปกติรับได้แค่คำสั่งเดียวต่อครั้ง)
 * `query` ใช้ extended protocol เพราะต้องส่ง parameter
 */
export interface RawSession {
  exec(sqlText: string): Promise<void>;
  query(sqlText: string, params: readonly unknown[]): Promise<void>;
}

export interface DatabaseHandle {
  readonly db: Db;
  readonly driver: 'node-postgres' | 'pglite';
  /** รัน callback ใน transaction เดียว (transactional = false สำหรับ DDL ที่ทำใน transaction ไม่ได้) */
  withRawSession<R>(
    handler: (session: RawSession) => Promise<R>,
    options?: { transactional?: boolean },
  ): Promise<R>;
  close(): Promise<void>;
}

export interface PostgresOptions {
  connectionString: string;
  poolMax?: number;
  statementTimeoutMs?: number;
  ssl?: boolean;
}

export function createPostgresDatabase(options: PostgresOptions): DatabaseHandle {
  // require แบบ lazy: production bundle ไม่ควรต้องมี @electric-sql/pglite ติดมาด้วย
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require('pg') as typeof import('pg');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { drizzle } = require('drizzle-orm/node-postgres') as typeof import('drizzle-orm/node-postgres');

  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.poolMax ?? 10,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    ...(options.ssl === true ? { ssl: { rejectUnauthorized: true } } : {}),
  });

  const db = drizzle(pool, { schema: schemaTables }) as unknown as Db;

  return {
    db,
    driver: 'node-postgres',
    withRawSession: async (handler, sessionOptions) => {
      const transactional = sessionOptions?.transactional ?? true;
      const client = await pool.connect();
      const session: RawSession = {
        exec: async (sqlText) => {
          // ไม่ส่ง values → node-postgres ใช้ simple protocol ซึ่งรับหลายคำสั่งได้
          await client.query(sqlText);
        },
        query: async (sqlText, params) => {
          await client.query(sqlText, params as unknown[]);
        },
      };

      try {
        if (transactional) await client.query('BEGIN');
        const result = await handler(session);
        if (transactional) await client.query('COMMIT');
        return result;
      } catch (error) {
        if (transactional) await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    close: async () => {
      await pool.end();
    },
  };
}

export interface PgliteOptions {
  /** ไม่ระบุ = in-memory */
  dataDir?: string;
}

export function createPgliteDatabase(options: PgliteOptions = {}): DatabaseHandle {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PGlite } = require('@electric-sql/pglite') as typeof import('@electric-sql/pglite');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { drizzle } = require('drizzle-orm/pglite') as typeof import('drizzle-orm/pglite');

  const client = options.dataDir === undefined ? new PGlite() : new PGlite(options.dataDir);
  const db = drizzle(client, { schema: schemaTables }) as unknown as Db;

  return {
    db,
    driver: 'pglite',
    withRawSession: async (handler, sessionOptions) => {
      const transactional = sessionOptions?.transactional ?? true;

      if (!transactional) {
        return handler({
          exec: async (sqlText) => {
            await client.exec(sqlText);
          },
          query: async (sqlText, params) => {
            await client.query(sqlText, params as unknown[]);
          },
        });
      }

      // PGlite คืน undefined เมื่อ transaction ถูก rollback ภายใน
      // ห่อผลลัพธ์ไว้ในกล่องเพื่อแยกกรณีนั้นออกจาก handler ที่คืน void โดยปกติ
      const boxed = await client.transaction(async (tx) => ({
        value: await handler({
          exec: async (sqlText) => {
            await tx.exec(sqlText);
          },
          query: async (sqlText, params) => {
            await tx.query(sqlText, params as unknown[]);
          },
        }),
      }));

      if (boxed === undefined) {
        throw new Error('pglite transaction was rolled back');
      }
      return boxed.value;
    },
    close: async () => {
      await client.close();
    },
  };
}

/**
 * รัน callback ใน transaction ที่ตั้ง tenant GUC ไว้แล้ว
 *
 * ใช้ `set_config(..., is_local => true)` ซึ่งเทียบเท่า `SET LOCAL` แต่รับ parameter ได้
 * — `SET LOCAL` ตรง ๆ ไม่รับ bind parameter จึงต้องต่อ string เอง ซึ่งเป็นช่อง SQL injection
 *
 * `is_local = true` สำคัญมาก: ค่าจะถูกคืนเมื่อจบ transaction ไม่ติดค้างไปกับ
 * connection ตัวถัดไปที่หยิบจาก pool (ADR-0005 ชั้น 3)
 */
export async function withTenant<R>(
  db: Db,
  tenantId: string,
  handler: (tx: Tx) => Promise<R>,
): Promise<R> {
  return db.transaction(async (tx) => {
    // SET LOCAL ROLE ก่อนเสมอ: FORCE ROW LEVEL SECURITY ไม่มีผลกับ superuser
    // หรือ role ที่มี BYPASSRLS การรันด้วย role ที่ถูกจำกัดจึงเป็นสิ่งที่ทำให้
    // policy มีผลจริง ไม่ใช่แค่ประกาศไว้เฉย ๆ
    //
    // production: connection เป็น workforce_app อยู่แล้ว คำสั่งนี้เป็น no-op
    // dev/test: connection เป็น owner/superuser คำสั่งนี้ลดสิทธิ์ลงมาให้ตรงกับ production
    await tx.execute(sql`SET LOCAL ROLE workforce_app`);
    await tx.execute(sql`SELECT set_config('workforce.tenant_id', ${tenantId}, true)`);
    return handler(tx as unknown as Tx);
  });
}

/**
 * Transaction สำหรับตารางโครงสร้างพื้นฐานที่ไม่มี RLS
 * (outbox, inbox, jobs, idempotency_keys, schema_migrations)
 *
 * ห้ามใช้กับ business table — ถ้า tenant GUC ไม่ถูกตั้ง RLS จะกรองทุกแถวออก
 * ทำให้ query คืนค่าว่างแทนที่จะ error ซึ่งจับได้ยาก
 */
export async function withSystemTransaction<R>(db: Db, handler: (tx: Tx) => Promise<R>): Promise<R> {
  return db.transaction(async (tx) => handler(tx as unknown as Tx));
}

/** ตั้ง tenant GUC บน handle ที่อยู่ใน transaction อยู่แล้ว */
export async function setTenantContext(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`SELECT set_config('workforce.tenant_id', ${tenantId}, true)`);
}

export async function clearTenantContext(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT set_config('workforce.tenant_id', '', true)`);
}

export interface DatabaseUrlOptions {
  databaseUrl: string;
  isProduction: boolean;
  poolMax?: number;
  statementTimeoutMs?: number;
  ssl?: boolean;
}

/**
 * เลือก driver จาก DATABASE_URL
 *
 * `pglite:<path>` รัน PostgreSQL ที่ compile เป็น WASM ในโปรเซสเดียวกัน ใช้เดโม
 * และ dev บนเครื่องที่ไม่มี PostgreSQL — ปฏิเสธใน production เพราะเป็น
 * single-connection และไม่มี backup/replication ใด ๆ (ADR-0011)
 */
export function createDatabaseFromUrl(options: DatabaseUrlOptions): DatabaseHandle {
  if (options.databaseUrl.startsWith('pglite:')) {
    if (options.isProduction) {
      throw new Error('DATABASE_URL=pglite: is not allowed when NODE_ENV=production');
    }
    const dataDir = options.databaseUrl.slice('pglite:'.length);
    return createPgliteDatabase(dataDir === '' || dataDir === 'memory' ? {} : { dataDir });
  }

  return createPostgresDatabase({
    connectionString: options.databaseUrl,
    ...(options.poolMax === undefined ? {} : { poolMax: options.poolMax }),
    ...(options.statementTimeoutMs === undefined
      ? {}
      : { statementTimeoutMs: options.statementTimeoutMs }),
    ...(options.ssl === undefined ? {} : { ssl: options.ssl }),
  });
}
