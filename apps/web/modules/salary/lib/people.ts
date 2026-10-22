import "server-only";
import { prisma } from "@smartboss/database";

/**
 * ผูกพนักงาน (ระบบบุคคล) ↔ บัญชีผู้ใช้ — ปกติผูกผ่าน principal แต่คนที่เพิ่งนำเข้าจะยังไม่ผูกจนกว่าเจ้าตัวจะเปิดแอป
 * ระหว่างนั้นใช้อีเมลจับคู่ (กฎเดียวกับที่ระบบบุคคลใช้ผูก principal) — ไม่งั้นสลิปไม่ขึ้นให้เจ้าตัว
 * และกันคนทำเงินเดือนแก้ของตัวเองไม่ได้ · เติมเฉพาะแถวที่ยังไม่มี subject และอีเมลตรงผู้ใช้ที่ยังไม่ผูกกับใคร
 */
export async function fillSubjectsByEmail<T extends { subject: string | null; email: string | null }>(orgId: string, rows: T[]): Promise<T[]> {
  const missing = rows.filter((r) => !r.subject && r.email);
  if (missing.length === 0) return rows;
  const taken = new Set(rows.map((r) => r.subject).filter(Boolean));
  const users = await prisma.user.findMany({
    where: { orgId, OR: missing.map((r) => ({ email: { equals: r.email!, mode: "insensitive" as const } })) },
    select: { id: true, email: true },
  });
  const byEmail = new Map(users.filter((u) => !taken.has(u.id)).map((u) => [u.email.toLowerCase(), u.id]));
  for (const r of missing) {
    const id = byEmail.get(r.email!.toLowerCase());
    if (id) {
      r.subject = id;
      byEmail.delete(r.email!.toLowerCase());
    }
  }
  return rows;
}
