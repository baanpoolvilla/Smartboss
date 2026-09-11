import { randomUUID } from "node:crypto";
import { prisma } from "@smartboss/database";

/**
 * Harness ของชุดเทสต์แยกบริษัท (fix-list ข้อ 1 track B)
 *
 * ⚠ ต้องรันกับ "test database" แยกที่ทิ้งได้ ไม่ใช่ DB dev จริงเด็ดขาด — ดู
 * README.md ในโฟลเดอร์นี้สำหรับวิธีตั้งค่า DATABASE_URL ก่อนรัน
 * `pnpm --filter web test:tenant-isolation` การล้างข้อมูลใน finally ด้านล่าง
 * เป็นแค่ความสะดวกตอน dev รันซ้ำในเครื่องเดียวหลายรอบ ไม่ใช่กลไกความถูกต้อง
 * หลัก — ถ้า process ถูกฆ่ากลางคัน (CI timeout, Ctrl-C) finally จะไม่รัน แต่
 * เพราะ DB นี้เป็น throwaway ก็แค่ไม่มีใครเดือดร้อน (ดรอปทิ้ง/สร้างใหม่ได้เสมอ)
 */
export async function withOrgPair<T>(
  run: (ctx: { orgA: string; orgB: string }) => Promise<T>
): Promise<T> {
  const suffix = randomUUID().slice(0, 8);
  const [orgA, orgB] = await Promise.all([
    prisma.organization.create({
      data: { code: `TEST-A-${suffix}`, slug: `test-org-a-${suffix}`, name: `Test Org A ${suffix}` },
    }),
    prisma.organization.create({
      data: { code: `TEST-B-${suffix}`, slug: `test-org-b-${suffix}`, name: `Test Org B ${suffix}` },
    }),
  ]);

  try {
    return await run({ orgA: orgA.id, orgB: orgB.id });
  } finally {
    // best-effort — ดูคอมเมนต์หัวไฟล์ · onDelete: Cascade ของ Organization
    // ลากลูกทุกตารางที่ผูกไว้ (User, ReportTaskStore, ...) หายไปด้วย แต่ยัง
    // ไม่ได้ยืนยันว่าครบทุกตารางที่จะ seed ในเทสต์ที่กว้างขึ้นทีหลัง (ตาม
    // ที่คุยไว้ — ค่อยเช็คตอนขยายจริง ไม่ใช่ตอนนี้ที่ยังมีแค่ ExampleItem)
    await Promise.allSettled([
      prisma.organization.delete({ where: { id: orgA.id } }),
      prisma.organization.delete({ where: { id: orgB.id } }),
    ]);
  }
}
