import "server-only";
import { prisma } from "@smartboss/database";
import { listUsersAcrossOrgs } from "./users";
import { getSupportOrgId } from "./issue-console-access";
import { SUPPORT_STAFF_ROLES } from "../support-org";

/**
 * ทีมรับเรื่องแจ้งบัค = Super Admin ทุกคนที่ยังใช้งานอยู่ + CEO/ADMIN ของบริษัทเรา
 * (ISSUE_SUPPORT_ORG) — ใช้ทั้งเป็นรายชื่อ "ผู้รับผิดชอบ" ในหน้าตั๋ว และเป็นผู้รับ
 * แจ้งเตือนตอนมีตั๋วใหม่/ผู้แจ้งตอบกลับ ไม่เช็คสิทธิ์ผู้เรียก (ผู้เรียกฝั่งแจ้งเตือน
 * คือพนักงานทั่วไปที่เพิ่งแจ้งปัญหา) แค่หาว่า "ใครคือทีมรับเรื่อง"
 */
export async function listIssueStaff(): Promise<{ id: string; name: string }[]> {
  const all = await listUsersAcrossOrgs();
  const people = new Map(all.filter((u) => u.hasSystemRole && u.isActive).map((u) => [u.id, u.name]));
  const supportOrgId = await getSupportOrgId();
  if (supportOrgId) {
    const staff = await prisma.user.findMany({
      where: { orgId: supportOrgId, isActive: true, roles: { some: { role: { code: { in: [...SUPPORT_STAFF_ROLES] } } } } },
      select: { id: true, name: true },
    });
    for (const u of staff) people.set(u.id, u.name);
  }
  return Array.from(people, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "th"));
}
