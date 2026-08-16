import { config } from "dotenv";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

/**
 * รันก่อน deploy migration `role_only_department_heads` เท่านั้น — ต้องรันตอนที่
 * core.positions / core.position_permissions / core.department_permissions
 * ยังอยู่ในฐานข้อมูลจริง (migration นั้นจะ DROP ทั้งสามตารางทันที)
 *
 * ใช้ raw SQL ล้วน ไม่ใช่ prisma.position.findMany() ฯลฯ เพราะ Prisma client
 * ที่ generate จาก schema ใหม่แล้วไม่มี type ของ Position เหลืออยู่เลย แม้ตาราง
 * จริงในฐานข้อมูลจะยังไม่ถูกลบก็ตาม (client กับ DB คนละ state กันได้ชั่วคราว)
 *
 * เทียบ "สิทธิ์ที่ user เคยได้จริง" (role ∪ department ∪ position) กับ
 * "สิทธิ์ที่จะเหลือหลัง migrate" (role อย่างเดียว) แล้วเขียนเฉพาะคนที่ "เสีย
 * สิทธิ์" ไปเป็น CSV ให้ทบทวนก่อนตัดสินใจว่าต้องสร้าง role ชดเชยให้ใครไหม
 *
 * รัน: pnpm --filter @smartboss/database exec tsx scripts/migrate-perms-report.ts
 * output: packages/database/migrate-perms-report.csv (อยู่ข้าง cwd ตอนรัน)
 */

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

const prisma = new PrismaClient();

interface UserRow {
  id: string;
  email: string;
}

async function main() {
  const users = await prisma.$queryRawUnsafe<UserRow[]>(
    `SELECT id, email FROM core.users WHERE is_active = true ORDER BY email`
  );

  const rolePermsByUser = await prisma.$queryRawUnsafe<{ user_id: string; code: string }[]>(`
    SELECT ur.user_id, p.code
    FROM core.user_roles ur
    JOIN core.role_permissions rp ON rp.role_id = ur.role_id
    JOIN core.permissions p ON p.id = rp.permission_id
  `);

  const deptPermsByUser = await prisma.$queryRawUnsafe<{ user_id: string; code: string }[]>(`
    SELECT u.id AS user_id, p.code
    FROM core.users u
    JOIN core.department_permissions dp ON dp.department_id = u.department_id
    JOIN core.permissions p ON p.id = dp.permission_id
    WHERE u.department_id IS NOT NULL
  `);

  const posPermsByUser = await prisma.$queryRawUnsafe<{ user_id: string; code: string }[]>(`
    SELECT u.id AS user_id, p.code
    FROM core.users u
    JOIN core.position_permissions pp ON pp.position_id = u.position_id
    JOIN core.permissions p ON p.id = pp.permission_id
    WHERE u.position_id IS NOT NULL
  `);

  const roleMap = groupByUser(rolePermsByUser);
  const deptMap = groupByUser(deptPermsByUser);
  const posMap = groupByUser(posPermsByUser);

  const rows: string[] = ["userId,email,keptViaRole,lostPerms"];
  let affectedCount = 0;

  for (const u of users) {
    const roleOnly = roleMap.get(u.id) ?? new Set<string>();
    const effective = new Set<string>([
      ...roleOnly,
      ...(deptMap.get(u.id) ?? []),
      ...(posMap.get(u.id) ?? []),
    ]);

    const lost = [...effective].filter((code) => !roleOnly.has(code)).sort();
    if (lost.length === 0) continue; // ไม่เสียสิทธิ์อะไร — ไม่ต้องอยู่ใน report

    affectedCount += 1;
    rows.push(
      [u.id, u.email, roleOnly.size, `"${lost.join("; ")}"`].join(",")
    );
  }

  const outPath = resolve(process.cwd(), "migrate-perms-report.csv");
  writeFileSync(outPath, rows.join("\n"), "utf8");

  console.log(`ตรวจ user ที่ active ทั้งหมด ${users.length} คน`);
  console.log(`พบ ${affectedCount} คนที่จะเสียสิทธิ์บางส่วนหลัง migrate (ดู ${outPath})`);
  if (affectedCount > 0) {
    console.log(
      "ทบทวนคอลัมน์ lostPerms ของแต่ละคน — ถ้าสิทธิ์นั้นสำคัญ ให้สร้าง/แก้ role " +
        "แล้วมอบให้คนกลุ่มนี้ก่อน deploy migration (ดู PLAN Phase 4.3)"
    );
  }
}

function groupByUser(rows: { user_id: string; code: string }[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!map.has(r.user_id)) map.set(r.user_id, new Set());
    map.get(r.user_id)!.add(r.code);
  }
  return map;
}

main()
  .catch((err) => {
    console.error("[migrate-perms-report] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
