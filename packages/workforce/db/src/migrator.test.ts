import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPgliteDatabase, type DatabaseHandle } from './client';
import {
  defaultMigrationsDir,
  getAppliedMigrations,
  loadMigrations,
  migrate,
  MigrationChecksumError,
  verifyMigrations,
} from './migrator';

const handles: DatabaseHandle[] = [];

function newDatabase(): DatabaseHandle {
  const handle = createPgliteDatabase();
  handles.push(handle);
  return handle;
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map(async (handle) => handle.close()));
});

/** คัดลอก migration จริงไปยังไดเรกทอรีชั่วคราว เพื่อทดลองแก้ไฟล์โดยไม่แตะของจริง */
function copyMigrationsToTemp(): string {
  const directory = mkdtempSync(join(tmpdir(), 'workforce-migrations-'));
  for (const migration of loadMigrations(defaultMigrationsDir())) {
    writeFileSync(join(directory, migration.fileName), migration.sqlText, 'utf8');
  }
  return directory;
}

describe('loadMigrations', () => {
  it('reads the real migration set in version order', () => {
    const migrations = loadMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.map((migration) => migration.version)).toEqual(
      [...migrations.map((migration) => migration.version)].sort((a, b) => a - b),
    );
    for (const migration of migrations) {
      expect(migration.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(migration.runInTransaction).toBe(true);
    }
  });
});

describe('migrate', () => {
  it('applies pending migrations and is safe to run twice', async () => {
    const handle = newDatabase();

    const first = await migrate(handle);
    expect(first.applied.length).toBeGreaterThan(0);
    expect(first.alreadyApplied).toBe(0);

    const second = await migrate(handle);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toBe(first.applied.length);

    const applied = await getAppliedMigrations(handle.db);
    expect(applied.map((row) => row.version)).toEqual(
      first.applied.map((migration) => migration.version),
    );
  });

  it('refuses to continue when an applied migration file was edited', async () => {
    // ADR-0003: migration ที่ apply แล้วเป็น immutable — การแก้ย้อนหลังทำให้
    // schema จริงกับไฟล์ในโค้ดต่างกันโดยไม่มีใครรู้
    const directory = copyMigrationsToTemp();
    const handle = newDatabase();
    await migrate(handle, { directory });

    const [firstFile] = loadMigrations(directory);
    const path = join(directory, (firstFile as { fileName: string }).fileName);
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n-- edited after the fact\n`, 'utf8');

    await expect(migrate(handle, { directory })).rejects.toThrow(MigrationChecksumError);
  });

  it('rolls back a failing migration so it is not recorded as applied', async () => {
    const directory = copyMigrationsToTemp();
    writeFileSync(join(directory, '9999_broken.sql'), 'CREATE TABLE workforce.a (id int);\nSELECT 1/0;\n', 'utf8');

    const handle = newDatabase();
    await expect(migrate(handle, { directory })).rejects.toThrow();

    const applied = await getAppliedMigrations(handle.db);
    expect(applied.map((row) => row.version)).not.toContain(9999);
  });

  it('rejects a badly named migration file', async () => {
    const directory = copyMigrationsToTemp();
    writeFileSync(join(directory, 'add-something.sql'), 'SELECT 1;', 'utf8');
    expect(() => loadMigrations(directory)).toThrow(/NNNN_snake_case\.sql/);
  });

  it('rejects duplicate version numbers', async () => {
    const directory = copyMigrationsToTemp();
    writeFileSync(join(directory, '0001_duplicate.sql'), 'SELECT 1;', 'utf8');
    expect(() => loadMigrations(directory)).toThrow(/duplicate migration version/);
  });
});

describe('verifyMigrations', () => {
  it('reports a fresh database as having pending migrations', async () => {
    const handle = newDatabase();
    const status = await verifyMigrations(handle.db);
    expect(status.upToDate).toBe(false);
    expect(status.pending.length).toBeGreaterThan(0);
    expect(status.drifted).toEqual([]);
  });

  it('reports a migrated database as up to date', async () => {
    const handle = newDatabase();
    await migrate(handle);
    expect(await verifyMigrations(handle.db)).toEqual({
      upToDate: true,
      pending: [],
      drifted: [],
    });
  });

  it('reports drift without modifying anything', async () => {
    const directory = copyMigrationsToTemp();
    const handle = newDatabase();
    await migrate(handle, { directory });

    const [firstFile] = loadMigrations(directory);
    const path = join(directory, (firstFile as { fileName: string }).fileName);
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n-- drift\n`, 'utf8');

    const status = await verifyMigrations(handle.db, { directory });
    expect(status.upToDate).toBe(false);
    expect(status.drifted).toHaveLength(1);
  });
});
