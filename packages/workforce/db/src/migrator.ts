import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import type { DatabaseHandle, Db } from './client';

const MIGRATION_FILE_RE = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const NO_TRANSACTION_MARKER = '-- @no-transaction';

export interface MigrationFile {
  version: number;
  name: string;
  fileName: string;
  sqlText: string;
  checksum: string;
  runInTransaction: boolean;
}

export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
  appliedAt: Date;
}

export class MigrationChecksumError extends Error {
  constructor(fileName: string, expected: string, actual: string) {
    super(
      `migration ${fileName} was modified after it was applied ` +
        `(recorded checksum ${expected}, file checksum ${actual}). ` +
        'Migrations are immutable once applied — add a new migration instead.',
    );
    this.name = 'MigrationChecksumError';
  }
}

export function defaultMigrationsDir(): string {
  return resolve(__dirname, '..', 'migrations');
}

export function loadMigrations(directory: string = defaultMigrationsDir()): MigrationFile[] {
  const files = readdirSync(directory).filter((file) => file.endsWith('.sql')).sort();

  const migrations: MigrationFile[] = [];
  const seenVersions = new Set<number>();

  for (const fileName of files) {
    const match = MIGRATION_FILE_RE.exec(fileName);
    if (!match) {
      throw new Error(`migration file name must match NNNN_snake_case.sql, found: ${fileName}`);
    }

    const version = Number(match[1]);
    if (seenVersions.has(version)) {
      throw new Error(`duplicate migration version ${version} (${fileName})`);
    }
    seenVersions.add(version);

    const sqlText = readFileSync(join(directory, fileName), 'utf8');
    migrations.push({
      version,
      name: match[2] ?? fileName,
      fileName,
      sqlText,
      checksum: createHash('sha256').update(sqlText.replace(/\r\n/g, '\n')).digest('hex'),
      runInTransaction: !sqlText.includes(NO_TRANSACTION_MARKER),
    });
  }

  return migrations;
}

async function ensureMigrationTable(db: Db): Promise<void> {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS workforce`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS workforce.schema_migrations (
      version     integer PRIMARY KEY,
      name        text NOT NULL,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      applied_by  text NOT NULL DEFAULT current_user,
      notes       text NOT NULL DEFAULT ''
    )
  `);
}

export async function getAppliedMigrations(db: Db): Promise<AppliedMigration[]> {
  await ensureMigrationTable(db);
  const result = await db.execute(sql`
    SELECT version, name, checksum, applied_at
    FROM workforce.schema_migrations
    ORDER BY version
  `);

  return (result.rows as Record<string, unknown>[]).map((row) => ({
    version: Number(row['version']),
    name: String(row['name']),
    checksum: String(row['checksum']),
    appliedAt: new Date(String(row['applied_at'])),
  }));
}

export interface MigrateResult {
  applied: MigrationFile[];
  alreadyApplied: number;
}

/**
 * รัน migration ที่ยังไม่ถูก apply
 *
 * - แต่ละไฟล์รันใน transaction เดียว (เว้นไฟล์ที่ประกาศ `-- @no-transaction`)
 * - ถ้าไฟล์ที่ apply ไปแล้วถูกแก้ จะหยุดทันที ไม่ยอมให้ schema drift แบบเงียบ ๆ (ADR-0003)
 * - application ไม่เรียกฟังก์ชันนี้ตอน boot — เป็น deploy step แยก
 */
export async function migrate(
  handle: DatabaseHandle,
  options: { directory?: string; logger?: (message: string) => void } = {},
): Promise<MigrateResult> {
  const log = options.logger ?? (() => {});
  const migrations = loadMigrations(options.directory);
  const applied = await getAppliedMigrations(handle.db);
  const appliedByVersion = new Map(applied.map((row) => [row.version, row]));

  // ตรวจ checksum ของ *ทุก* ไฟล์ก่อนเริ่ม apply — ถ้ามีไฟล์เก่าถูกแก้
  // ต้องหยุดทั้งชุด ไม่ใช่ apply ไฟล์ใหม่ทับ schema ที่ drift ไปแล้ว
  for (const migration of migrations) {
    const record = appliedByVersion.get(migration.version);
    if (record !== undefined && record.checksum !== migration.checksum) {
      throw new MigrationChecksumError(migration.fileName, record.checksum, migration.checksum);
    }
  }

  const pending = migrations.filter((migration) => !appliedByVersion.has(migration.version));
  if (pending.length === 0) {
    log(`schema up to date (${applied.length} migrations applied)`);
    return { applied: [], alreadyApplied: applied.length };
  }

  for (const migration of pending) {
    log(`applying ${migration.fileName}`);
    await handle.withRawSession(
      async (session) => {
        await session.exec(migration.sqlText);
        await session.query(
          `INSERT INTO workforce.schema_migrations (version, name, checksum)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum],
        );
      },
      { transactional: migration.runInTransaction },
    );
    log(`applied  ${migration.fileName}`);
  }

  return { applied: pending, alreadyApplied: applied.length };
}

/** ตรวจว่า schema ตรงกับไฟล์ migration หรือไม่ โดยไม่แก้อะไร — ใช้ใน health check และ CI */
export async function verifyMigrations(
  db: Db,
  options: { directory?: string } = {},
): Promise<{ upToDate: boolean; pending: string[]; drifted: string[] }> {
  const migrations = loadMigrations(options.directory);
  const applied = await getAppliedMigrations(db);
  const appliedByVersion = new Map(applied.map((row) => [row.version, row]));

  const pending: string[] = [];
  const drifted: string[] = [];

  for (const migration of migrations) {
    const record = appliedByVersion.get(migration.version);
    if (record === undefined) pending.push(migration.fileName);
    else if (record.checksum !== migration.checksum) drifted.push(migration.fileName);
  }

  return { upToDate: pending.length === 0 && drifted.length === 0, pending, drifted };
}
