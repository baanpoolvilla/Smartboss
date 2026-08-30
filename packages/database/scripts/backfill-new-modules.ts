import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * เติมแถว Module ที่ seed.ts เพิ่มเข้ามาทีหลัง แต่ยังไม่เคยรันซ้ำบนฐานข้อมูลจริง
 * (seed.ts รันครั้งเดียวตอนติดตั้ง — เพิ่มโมดูลใน seed.ts ไม่ทำให้แถวเกิดขึ้นเอง)
 *
 * ทำไมแยกจาก backfill-role-grants.ts: สคริปต์นั้นเติมสิทธิ์ (Permission +
 * RolePermission) แต่ต้องมีแถว Module อยู่ก่อนแล้วถึงจะผูก moduleId ถูก และ
 * `/admin/modules` เองก็ query จากตาราง Module ตรง ๆ (ดู listOrgModules) —
 * ไม่มีแถว = ไม่มีสวิตช์ให้เปิดเลย ต่อให้สิทธิ์พร้อมแล้วก็ตาม
 *
 * ปลอดภัย รันซ้ำได้: upsert ด้วย code เป็น key, ไม่แตะ OrgModule (การเปิด/ปิด
 * ต่อบริษัทเป็นคนละตารางกับตรงนี้ ดู toggleModuleAction)
 *
 * รัน: pnpm --filter @smartboss/database exec tsx scripts/backfill-new-modules.ts
 *      เติม --dry-run เพื่อดูว่าจะสร้างอะไรบ้างโดยยังไม่เขียนลงฐานข้อมูล
 */

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

// ต้องตรงกับที่ seed.ts นิยามไว้ทุกตัวอักษร (ดู seed.ts ส่วน "5) แคตตาล็อกโมดูล")
const MODULE_DEFS = [
  { code: "chat", name: "แชท", color: "#7C3AED", sortOrder: 7 },
  { code: "company_files", name: "ไฟล์บริษัท", color: "#0EA5E9", sortOrder: 8 },
] as const;

async function main() {
  const existing = new Set((await prisma.module.findMany({ select: { code: true } })).map((m) => m.code));
  const missing = MODULE_DEFS.filter((m) => !existing.has(m.code));

  if (missing.length === 0) {
    console.log("✔ ทุกโมดูลมีแถวในฐานข้อมูลอยู่แล้ว — ไม่มีอะไรต้องเพิ่ม");
    return;
  }

  console.log(`จะเพิ่มแถว Module ${missing.length} รายการ: ${missing.map((m) => m.code).join(", ")}`);
  if (dryRun) {
    console.log("[dry-run] ยังไม่เขียนลงฐานข้อมูล");
    return;
  }

  for (const m of missing) {
    await prisma.module.upsert({
      where: { code: m.code },
      update: {},
      create: { code: m.code, name: m.name, color: m.color, isEnabled: false, sortOrder: m.sortOrder },
    });
  }
  console.log(`✔ เพิ่มแถว Module แล้ว — ต่อไปรัน backfill-role-grants.ts เพื่อลงทะเบียนสิทธิ์ของโมดูลนี้`);
}

main()
  .catch((err) => {
    console.error("[backfill-new-modules] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
