#!/usr/bin/env node
import { loadDotenvFile } from '@workforce/config';
import { createDatabaseFromUrl, createPgliteDatabase, type DatabaseHandle } from '../client';
import { migrate, verifyMigrations } from '../migrator';

/**
 * รัน migration เป็น deploy step แยก — application ไม่ทำเองตอน boot (ADR-0003)
 *
 *   pnpm db:migrate            รัน migration ที่ค้างอยู่
 *   pnpm db:migrate --verify   ตรวจอย่างเดียว ไม่แก้ (ใช้ใน CI/health check)
 */
async function main(): Promise<void> {
  loadDotenvFile();

  const verifyOnly = process.argv.includes('--verify');
  const connectionString = process.env['DATABASE_URL'];

  let handle: DatabaseHandle;
  if (connectionString === undefined || connectionString === '') {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('DATABASE_URL is required');
    }
    console.warn('DATABASE_URL not set — using ephemeral PGlite (development only)');
    handle = createPgliteDatabase();
  } else {
    handle = createDatabaseFromUrl({
      databaseUrl: connectionString,
      isProduction: process.env['NODE_ENV'] === 'production',
      ssl: process.env['DATABASE_SSL'] === 'true',
    });
  }

  try {
    if (verifyOnly) {
      const status = await verifyMigrations(handle.db);
      if (status.drifted.length > 0) {
        console.error(`schema drift detected in: ${status.drifted.join(', ')}`);
        process.exitCode = 2;
        return;
      }
      if (status.pending.length > 0) {
        console.error(`pending migrations: ${status.pending.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      console.log('schema is up to date');
      return;
    }

    const result = await migrate(handle, { logger: (message) => console.log(message) });
    console.log(
      `done — ${result.applied.length} applied, ${result.alreadyApplied} already present (driver: ${handle.driver})`,
    );
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
