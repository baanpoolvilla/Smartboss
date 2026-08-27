import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { ROLE_GRANTS } from "../defaults";

/**
 * ไล่มอบสิทธิ์ตาม ROLE_GRANTS ให้บทบาทมาตรฐานของ **ทุกบริษัทที่มีอยู่แล้ว**
 *
 * ทำไมเป็นสคริปต์ ไม่ใช่ SQL ใน migration: ถ้าเขียนตาราง grant ซ้ำลงไปใน SQL
 * ก็จะเกิดอาการที่ header ของ defaults.ts เตือนไว้เอง — สิทธิ์ถูกนิยามสองที่
 * แล้ววันหนึ่งไม่ตรงกันโดยไม่มี error ให้เห็น สคริปต์นี้ import ของจริงมาใช้
 * จึงไม่มีวันเพี้ยนจาก defaults.ts
 *
 * ทำไมต้องมี: `createOrganizationAction` จงใจ "ข้ามสิทธิ์ที่ยังไม่มีในแคตตาล็อก"
 * แทนที่จะล้มทั้งชุด — ดีตอนรันจริง แต่แปลว่าบริษัทที่ถูกสร้างในจังหวะที่
 * แคตตาล็อกยังไม่ครบ จะได้สิทธิ์ไม่ครบแบบเงียบ ๆ ตลอดไป (พบจริงกับบริษัทที่
 * ADMIN ของตัวเองไม่มี core.admin จึงเข้าหลังบ้านไม่ได้เลย)
 *
 * **เพิ่มอย่างเดียว ไม่ลบอะไรทั้งสิ้น** — สิทธิ์ที่บริษัทติ๊กเพิ่มเองที่
 * /admin/roles ยังอยู่ครบ และรันซ้ำกี่รอบก็ได้ผลเท่าเดิม
 *
 * รัน: pnpm --filter @smartboss/database exec tsx scripts/backfill-role-grants.ts
 *      เติม --dry-run เพื่อดูว่าจะเพิ่มอะไรบ้างโดยยังไม่เขียนลงฐานข้อมูล
 */

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const permissionIdByCode = new Map(
    (await prisma.permission.findMany({ select: { id: true, code: true } })).map((p) => [
      p.code,
      p.id,
    ])
  );

  // สิทธิ์ที่ defaults บอกว่าต้องมี แต่ยังไม่มีในแคตตาล็อก — ต้นตอของอาการ
  // "ติ๊กสิทธิ์ที่ /admin/roles ไม่ได้เพราะไม่มีให้ติ๊ก" ลงให้เลย ไม่ใช่แค่เตือน
  // แล้วปล่อยให้ createOrganizationAction ข้ามมันเงียบ ๆ ต่อไปอีกรอบ
  const missingFromCatalog = [...new Set(Object.values(ROLE_GRANTS).flat())].filter(
    (code) => !permissionIdByCode.has(code)
  );
  if (missingFromCatalog.length > 0) {
    console.log(`ลงแคตตาล็อกสิทธิ์ที่ขาด ${missingFromCatalog.length} รายการ:`);
    console.log(`  ${missingFromCatalog.join(", ")}\n`);

    if (!dryRun) {
      // moduleId มาจาก prefix หน้าจุดแรก (hr.* → โมดูล hr) ยกเว้น core.* ที่เป็น
      // สิทธิ์หลังบ้าน ไม่ผูกโมดูล — ตรงกับที่ seed.ts ทำตอนติดตั้งใหม่
      const moduleIdByCode = new Map(
        (await prisma.module.findMany({ select: { id: true, code: true } })).map((m) => [
          m.code,
          m.id,
        ])
      );
      for (const code of missingFromCatalog) {
        const prefix = code.split(".")[0]!;
        const created = await prisma.permission.upsert({
          where: { code },
          update: {},
          create: { code, moduleId: prefix === "core" ? null : moduleIdByCode.get(prefix) ?? null },
        });
        permissionIdByCode.set(code, created.id);
      }
    }
  }

  const roles = await prisma.role.findMany({
    where: { orgId: { not: null }, code: { in: Object.keys(ROLE_GRANTS) } },
    select: {
      id: true,
      code: true,
      organization: { select: { slug: true } },
      permissions: { select: { permissionId: true } },
    },
    orderBy: [{ orgId: "asc" }, { code: "asc" }],
  });

  const rows: { roleId: string; permissionId: string }[] = [];
  let touchedRoles = 0;

  for (const role of roles) {
    const held = new Set(role.permissions.map((p) => p.permissionId));
    const toAdd = (ROLE_GRANTS[role.code] ?? [])
      .map((code) => permissionIdByCode.get(code))
      .filter((id): id is string => Boolean(id) && !held.has(id!));

    if (toAdd.length === 0) continue;
    touchedRoles += 1;
    console.log(
      `  ${(role.organization?.slug ?? "?").padEnd(10)} ${role.code.padEnd(11)} +${toAdd.length}`
    );
    for (const permissionId of toAdd) rows.push({ roleId: role.id, permissionId });
  }

  if (rows.length === 0) {
    console.log("✔ ทุกบทบาทมีสิทธิ์ครบตาม defaults.ts อยู่แล้ว — ไม่มีอะไรต้องเพิ่ม");
    return;
  }

  if (dryRun) {
    console.log(`\n[dry-run] จะเพิ่ม ${rows.length} สิทธิ์ ให้ ${touchedRoles} บทบาท (ยังไม่เขียน)`);
    return;
  }

  const { count } = await prisma.rolePermission.createMany({
    data: rows,
    skipDuplicates: true,
  });
  console.log(`\n✔ เพิ่ม ${count} สิทธิ์ ให้ ${touchedRoles} บทบาท`);
}

main()
  .catch((err) => {
    console.error("[backfill-role-grants] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
