#!/usr/bin/env node
import { loadDotenvFile } from '@workforce/config';
import { createDatabaseFromUrl } from '../client';
import { migrate } from '../migrator';
import { seedDemoTenant } from '../seed/demo';

/**
 * ใส่ข้อมูลตัวอย่างสำหรับ dev/demo
 * ปฏิเสธการทำงานเมื่อ NODE_ENV=production — seed ไม่ใช่ migration
 */
async function main(): Promise<void> {
  loadDotenvFile();

  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('refusing to seed demo data in production');
  }

  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL is required to seed');
  }

  const handle = createDatabaseFromUrl({
    databaseUrl: connectionString,
    isProduction: false,
  });
  try {
    await migrate(handle, { logger: (message) => console.log(message) });
    const result = await seedDemoTenant(handle.db, {
      tenantCode: process.env['DEMO_TENANT_CODE'] ?? 'demo',
    });

    console.log(`tenant:  ${result.tenantId}`);
    console.log(`company: ${result.companyId}`);
    console.log('principals:');
    for (const principal of result.principals) {
      console.log(`  ${principal.role.padEnd(18)} ${principal.subject}  (${principal.principalId})`);
    }
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
