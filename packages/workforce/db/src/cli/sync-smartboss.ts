#!/usr/bin/env node
import { Client } from 'pg';
import { loadDotenvFile } from '@workforce/config';
import { createDatabaseFromUrl } from '../client';
import { mapSmartbossRoles, provisionPrincipal, provisionTenant } from '../provisioning/smartboss';

/**
 * เชื่อมบริษัท/ผู้ใช้ของ Smartboss เข้ากับ workforce
 *
 *   pnpm wf:sync            สร้าง tenant + principal ที่ยังไม่มี
 *   pnpm wf:sync --dry-run  แสดงว่าจะทำอะไร โดยไม่เขียนจริง
 *
 * เรียกซ้ำได้ — ใช้เป็น deploy step หลังเพิ่มบริษัท/ผู้ใช้ใหม่
 * (Smartboss เก็บ core.* ใน database เดียวกัน จึงอ่านตรงได้)
 */
async function main(): Promise<void> {
  loadDotenvFile();

  const dryRun = process.argv.includes('--dry-run');
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL is required');
  }

  // อ่านฝั่ง Smartboss ด้วย pg ตรง ๆ — ไม่ผูกกับ Prisma เพื่อไม่ให้ package นี้
  // ต้องรู้จัก schema ของอีกระบบ
  const reader = new Client({ connectionString });
  await reader.connect();

  const handle = createDatabaseFromUrl({
    databaseUrl: connectionString,
    isProduction: process.env['NODE_ENV'] === 'production',
    ssl: process.env['DATABASE_SSL'] === 'true',
  });

  try {
    const orgs = await reader.query<{ id: string; slug: string; code: string; name: string }>(
      `SELECT id, slug, code, name FROM core.organizations WHERE is_active = true ORDER BY created_at`,
    );

    let tenantsCreated = 0;
    let companiesCreated = 0;
    let principalsCreated = 0;
    let rolesGranted = 0;

    for (const org of orgs.rows) {
      // ผู้ใช้ของบริษัทนี้ + role code + permission code ที่มี
      const users = await reader.query<{
        id: string;
        name: string;
        email: string;
        role_codes: string[] | null;
        permission_codes: string[] | null;
      }>(
        `SELECT u.id,
                u.name,
                u.email,
                array_remove(array_agg(DISTINCT r.code), NULL)  AS role_codes,
                array_remove(array_agg(DISTINCT p.code), NULL)  AS permission_codes
           FROM core.users u
           LEFT JOIN core.user_roles ur       ON ur.user_id = u.id
           LEFT JOIN core.roles r             ON r.id = ur.role_id
           LEFT JOIN core.role_permissions rp ON rp.role_id = r.id
           LEFT JOIN core.permissions p       ON p.id = rp.permission_id
          WHERE u.org_id = $1 AND u.is_active = true
          GROUP BY u.id, u.name, u.email
          ORDER BY u.created_at`,
        [org.id],
      );

      if (dryRun) {
        console.log(`[dry-run] tenant ${org.slug} (${org.id}) — ผู้ใช้ ${users.rows.length} คน`);
        for (const user of users.rows) {
          const mapped = mapSmartbossRoles({
            roles: user.role_codes ?? [],
            permissions: user.permission_codes ?? [],
          });
          console.log(`  - ${user.email} → ${mapped.join(', ')}`);
        }
        continue;
      }

      const tenant = await provisionTenant(handle.db, {
        tenantId: org.id,
        code: org.slug,
        companyCode: org.code,
        name: org.name,
      });
      if (tenant.created) tenantsCreated += 1;
      if (tenant.companyCreated) companiesCreated += 1;
      console.log(
        `tenant ${org.slug} ${tenant.created ? 'created' : 'exists'} — role ${tenant.roleIds.size}` +
          ` · company ${org.code} ${tenant.companyCreated ? 'created' : 'exists'}`,
      );

      for (const user of users.rows) {
        const result = await provisionPrincipal(handle.db, {
          tenantId: org.id,
          subject: user.id,
          displayName: user.name,
          email: user.email,
          workforceRoles: mapSmartbossRoles({
            roles: user.role_codes ?? [],
            permissions: user.permission_codes ?? [],
          }),
        });
        if (result.created) principalsCreated += 1;
        rolesGranted += result.rolesGranted.length;
        console.log(
          `  ${user.email} ${result.created ? 'created' : 'exists'}` +
            (result.rolesGranted.length > 0 ? ` +[${result.rolesGranted.join(', ')}]` : ''),
        );
      }
    }

    if (!dryRun) {
      console.log(
        `done — tenant ใหม่ ${tenantsCreated}, นิติบุคคลใหม่ ${companiesCreated},` +
          ` principal ใหม่ ${principalsCreated}, role ที่เพิ่ม ${rolesGranted}`,
      );
    }
  } finally {
    await reader.end();
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
