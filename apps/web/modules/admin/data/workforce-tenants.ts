import "server-only";
import { prisma } from "@smartboss/database";

/**
 * บริษัทไหนมี tenant ฝั่ง workforce แล้วบ้าง
 *
 * ใช้บอกบนหน้ารายชื่อบริษัทว่าบริษัทไหน "โมดูลบุคคลยังใช้ไม่ได้" — ถ้าไม่บอก
 * อาการที่ผู้ใช้เจอคือทุกหน้าในโมดูลบุคคลว่างเปล่าโดยไม่มี error ให้เห็น
 *
 * ── ทำไมต้องวนตั้ง tenant context ทีละบริษัท ──
 * ตาราง workforce ทุกใบเปิด FORCE ROW LEVEL SECURITY ซึ่ง **บังคับกับเจ้าของ
 * ตารางด้วย** การ `SELECT id FROM workforce.tenants` เฉย ๆ จึงคืน 0 แถวเสมอ
 * โดยไม่มี error — ไม่ใช่ "ไม่มีข้อมูล" แต่คือ "ถูกกรองทิ้ง"
 *
 * ตอนเขียนครั้งแรกผมพลาดตรงนี้จริง ๆ: หน้าจอขึ้นว่าทุกบริษัทยังไม่พร้อม
 * ทั้งที่ข้อมูลถูกต้อง กว่าจะรู้ต้องไปไล่ query ด้วยมือ จึงเขียนกำกับไว้ให้ชัด
 *
 * ทำในทรานแซกชันเดียว เปลี่ยน GUC ไปเรื่อย ๆ — จำนวนบริษัทเป็นหลักสิบ
 * ไม่ใช่หลักหมื่น จึงไม่คุ้มที่จะไปเพิ่ม policy พิเศษให้ role ค้นหาข้ามบริษัท
 */
export async function listWorkforceTenantIds(
  orgIds: string[]
): Promise<Set<string>> {
  if (orgIds.length === 0) return new Set();

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE workforce_app");
      const found = new Set<string>();

      for (const orgId of orgIds) {
        await tx.$executeRaw`SELECT set_config('workforce.tenant_id', ${orgId}, true)`;
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text AS id FROM workforce.tenants WHERE id = ${orgId}::uuid
        `;
        if (rows.length > 0) found.add(orgId);
      }

      return found;
    });
  } catch (err) {
    // ปกติ = schema workforce ยังไม่ถูกติดตั้ง (ยังไม่ได้รัน wf:migrate)
    // แต่ต้อง log ไว้เสมอ ไม่งั้นความผิดพลาดอื่นจะกลายเป็น "ทุกบริษัทยังไม่พร้อม"
    // ที่ดูเหมือนข้อมูลจริง — เคยหลงมาแล้วตอนเขียนฟังก์ชันนี้
    console.error("[workforce-tenants] อ่านรายชื่อ tenant ไม่สำเร็จ:", err);
    return new Set();
  }
}
